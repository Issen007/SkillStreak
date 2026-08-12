"""The plan generator's prompt construction, loop and logging discipline.

The model itself is not exercised here — loading a 3B model in CI is not
worth the minutes, and prompt construction is where the bugs that matter
live: a corpus that fails to reach the prompt produces a confident,
fluent, entirely invented training session.
"""

from __future__ import annotations

import json
import logging

import httpx
import pytest
import respx

from clip_tagger.plan_generator import (
    MAX_PLAN_CHARS,
    GeneratorConfig,
    PlanGenerator,
    build_prompt,
)

API = "https://api.example.test"


def job(**overrides):
    base = {
        "leaseId": "lease-1",
        "promptText": "kul pass med mycket rörelse",
        "ageBand": "9-11",
        "durationMinutes": 45,
        "focus": "passning",
        "locale": "sv",
        "corpusVersion": "2:a,b",
        "drills": [
            {
                "slug": "kortpassningar-under-press",
                "title": "Kortpassningar under press",
                "ageBand": "9-11",
                "focus": "passning",
                "durationMinutes": 15,
                "body": "En enkel passningsövning.",
            }
        ],
    }
    base.update(overrides)
    return base


class FakeModel:
    model_id = "fake-model"
    on_gpu = False

    def __init__(self, output="# Pass\n- 10 min uppvärmning"):
        self.output = output
        self.calls = []

    def generate(self, system, user):
        self.calls.append((system, user))
        return self.output


@pytest.fixture
def config():
    return GeneratorConfig(
        api_url=API,
        token="plan-token-not-a-real-secret-0123456789",
        model_id="fake-model",
        idle_sleep_seconds=0,
        error_sleep_seconds=0,
        request_timeout_seconds=5,
        max_new_tokens=64,
    )


class TestPrompt:
    def test_puts_every_drill_in_the_prompt(self):
        # There is no retrieval step: the app sends the whole corpus and
        # all of it must reach the model. A drill silently dropped here
        # produces a fluent, confident, invented session instead.
        _, user = build_prompt(job())
        assert "Kortpassningar under press" in user
        assert "En enkel passningsövning." in user
        assert "kortpassningar-under-press" in user

    def test_carries_the_coach_request_and_constraints(self):
        _, user = build_prompt(job())
        assert "kul pass med mycket rörelse" in user
        assert "9-11" in user
        assert "45" in user

    def test_instructs_against_inventing_drills(self):
        system, _ = build_prompt(job())
        assert "ENDAST" in system  # Swedish "only"

    def test_instructs_against_naming_players(self):
        # Belt and braces. The structural control is that the app never
        # enriches a prompt with roster data; this is the soft one, and
        # ADR-0028 Decision 8 is explicit that it is advisory.
        assert "aldrig namn" in build_prompt(job())[0]
        assert "Never name individual players" in build_prompt(job(locale="en"))[0]

    def test_switches_language(self):
        assert "floorball coach" in build_prompt(job(locale="en"))[0]
        assert "innebandytränare" in build_prompt(job(locale="sv"))[0]

    def test_falls_back_to_swedish_for_an_unknown_locale(self):
        assert "innebandytränare" in build_prompt(job(locale="de"))[0]

    def test_survives_an_empty_corpus(self):
        # Better a prompt that says so than a KeyError mid-generation.
        _, user = build_prompt(job(drills=[]))
        assert "no drills available" in user


class TestConfig:
    def test_requires_url_and_token(self, monkeypatch):
        monkeypatch.delenv("TRAINING_PLAN_API_URL", raising=False)
        monkeypatch.setenv("TRAINING_PLAN_WORKER_TOKEN", "x" * 40)
        with pytest.raises(RuntimeError, match="TRAINING_PLAN_API_URL"):
            GeneratorConfig.from_env()

    def test_refuses_plain_http(self, monkeypatch):
        monkeypatch.setenv("TRAINING_PLAN_API_URL", "http://api.example.test")
        monkeypatch.setenv("TRAINING_PLAN_WORKER_TOKEN", "x" * 40)
        with pytest.raises(RuntimeError, match="https"):
            GeneratorConfig.from_env()


class TestLoop:
    @respx.mock
    def test_no_work_is_not_an_error(self, config):
        respx.post(f"{API}/api/v1/training-plan-jobs/lease").mock(
            return_value=httpx.Response(204)
        )
        assert PlanGenerator(config, FakeModel()).run_once() is False

    @respx.mock
    def test_generates_and_posts_the_result(self, config):
        respx.post(f"{API}/api/v1/training-plan-jobs/lease").mock(
            return_value=httpx.Response(200, json=job())
        )
        result = respx.post(f"{API}/api/v1/training-plan-jobs/result").mock(
            return_value=httpx.Response(200, json={"applied": True})
        )

        assert PlanGenerator(config, FakeModel()).run_once() is True
        body = json.loads(result.calls[0].request.read())
        assert body["leaseId"] == "lease-1"
        assert body["modelId"] == "fake-model"
        # Echoed from the job, so a stored plan names the corpus it was
        # built from even if the library changes afterwards.
        assert body["corpusVersion"] == "2:a,b"

    @respx.mock
    def test_reports_failure_on_an_empty_completion(self, config):
        # An empty plan is a failure, not a plan. Storing it shows a coach
        # a blank page with no explanation.
        respx.post(f"{API}/api/v1/training-plan-jobs/lease").mock(
            return_value=httpx.Response(200, json=job())
        )
        failure = respx.post(f"{API}/api/v1/training-plan-jobs/failure").mock(
            return_value=httpx.Response(200, json={"applied": True})
        )
        assert PlanGenerator(config, FakeModel(output="   ")).run_once() is True
        assert failure.called

    @respx.mock
    def test_reports_failure_when_generation_raises(self, config):
        class Exploding(FakeModel):
            def generate(self, system, user):
                raise RuntimeError("out of memory")

        respx.post(f"{API}/api/v1/training-plan-jobs/lease").mock(
            return_value=httpx.Response(200, json=job())
        )
        failure = respx.post(f"{API}/api/v1/training-plan-jobs/failure").mock(
            return_value=httpx.Response(200, json={"applied": True})
        )
        assert PlanGenerator(config, Exploding()).run_once() is True
        assert failure.called


class TestDiscipline:
    @respx.mock
    def test_logs_neither_the_prompt_nor_the_plan(self, config, caplog):
        # A coach's prompt is their own words and may contain a name
        # however much the design discourages it; the plan is derived from
        # it. Neither belongs in this cluster's log stream.
        respx.post(f"{API}/api/v1/training-plan-jobs/lease").mock(
            return_value=httpx.Response(200, json=job())
        )
        respx.post(f"{API}/api/v1/training-plan-jobs/result").mock(
            return_value=httpx.Response(200, json={"applied": True})
        )

        with caplog.at_level(logging.INFO, logger="clip_tagger.plan_generator"):
            PlanGenerator(config, FakeModel()).run_once()

        logged = " ".join(r.getMessage() for r in caplog.records)
        assert "lease-1" in logged
        assert "kul pass med mycket rörelse" not in logged
        assert "uppvärmning" not in logged

    def test_the_plan_cap_is_bounded(self):
        # Stored in Postgres and rendered to a coach; a looping model can
        # emit megabytes.
        assert 0 < MAX_PLAN_CHARS <= 50_000
