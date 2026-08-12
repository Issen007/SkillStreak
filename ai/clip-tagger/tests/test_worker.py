"""The pull worker's loop, its limits, and its logging discipline."""

from __future__ import annotations

import base64
import logging

import httpx
import pytest
import respx

from clip_tagger.model import TAG_VALUES, StubTagger, load_prompt_set
from clip_tagger.worker import Worker, WorkerConfig

API = "https://api.example.test"


@pytest.fixture
def config():
    return WorkerConfig(
        api_url=API,
        token="worker-token-not-a-real-secret-0123456789",
        idle_sleep_seconds=0,
        error_sleep_seconds=0,
        request_timeout_seconds=5,
        max_frames=16,
    )


@pytest.fixture
def worker(config):
    return Worker(config, StubTagger(load_prompt_set("floorball-v1")))


def frame() -> str:
    import io

    from PIL import Image

    buffer = io.BytesIO()
    Image.new("RGB", (16, 16), (10, 120, 60)).save(buffer, "JPEG")
    return base64.b64encode(buffer.getvalue()).decode()


class TestConfig:
    def test_refuses_to_start_without_an_api_url(self, monkeypatch):
        monkeypatch.delenv("CLIP_TAGGING_API_URL", raising=False)
        monkeypatch.setenv("CLIP_TAGGING_WORKER_TOKEN", "x" * 40)
        with pytest.raises(RuntimeError, match="CLIP_TAGGING_API_URL"):
            WorkerConfig.from_env()

    def test_refuses_to_start_without_a_token(self, monkeypatch):
        monkeypatch.setenv("CLIP_TAGGING_API_URL", API)
        monkeypatch.delenv("CLIP_TAGGING_WORKER_TOKEN", raising=False)
        with pytest.raises(RuntimeError, match="CLIP_TAGGING_WORKER_TOKEN"):
            WorkerConfig.from_env()

    def test_refuses_plain_http(self, monkeypatch):
        # The credential and the frames both cross the public internet
        # under this topology; plain HTTP is not a degraded mode.
        monkeypatch.setenv("CLIP_TAGGING_API_URL", "http://api.example.test")
        monkeypatch.setenv("CLIP_TAGGING_WORKER_TOKEN", "x" * 40)
        with pytest.raises(RuntimeError, match="https"):
            WorkerConfig.from_env()


class TestLoop:
    @respx.mock
    def test_no_work_is_not_an_error(self, worker):
        respx.post(f"{API}/api/v1/clip-tagging/lease").mock(
            return_value=httpx.Response(204)
        )
        assert worker.run_once() is False

    @respx.mock
    def test_scores_a_lease_and_posts_the_result(self, worker):
        respx.post(f"{API}/api/v1/clip-tagging/lease").mock(
            return_value=httpx.Response(
                200, json={"leaseId": "lease-1", "frames": [frame(), frame()]}
            )
        )
        result = respx.post(f"{API}/api/v1/clip-tagging/result").mock(
            return_value=httpx.Response(200, json={"applied": True})
        )

        assert worker.run_once() is True

        body = result.calls[0].request.read()
        import json

        payload = json.loads(body)
        assert payload["leaseId"] == "lease-1"
        assert len(payload["scores"]) == len(TAG_VALUES)
        # Descending, so the app can threshold without re-sorting.
        values = [row["score"] for row in payload["scores"]]
        assert values == sorted(values, reverse=True)
        assert payload["modelId"] == "stub"
        assert payload["promptSetVersion"] == "floorball-v1"

    @respx.mock
    def test_sends_the_bearer_token(self, worker, config):
        route = respx.post(f"{API}/api/v1/clip-tagging/lease").mock(
            return_value=httpx.Response(204)
        )
        worker.run_once()
        assert (
            route.calls[0].request.headers["authorization"]
            == f"Bearer {config.token}"
        )

    @respx.mock
    def test_reports_failure_when_scoring_raises(self, config):
        class Exploding(StubTagger):
            def score(self, frames):
                raise RuntimeError("cuda is having a day")

        worker = Worker(config, Exploding(load_prompt_set("floorball-v1")))
        respx.post(f"{API}/api/v1/clip-tagging/lease").mock(
            return_value=httpx.Response(
                200, json={"leaseId": "lease-2", "frames": [frame()]}
            )
        )
        failure = respx.post(f"{API}/api/v1/clip-tagging/failure").mock(
            return_value=httpx.Response(200, json={"applied": True})
        )

        assert worker.run_once() is True
        # Reported rather than swallowed, so the app frees the lease now
        # instead of waiting out its TTL.
        assert failure.called

    @respx.mock
    def test_reports_failure_on_undecodable_frames(self, worker):
        respx.post(f"{API}/api/v1/clip-tagging/lease").mock(
            return_value=httpx.Response(
                200, json={"leaseId": "lease-3", "frames": ["not base64 !!"]}
            )
        )
        failure = respx.post(f"{API}/api/v1/clip-tagging/failure").mock(
            return_value=httpx.Response(200, json={"applied": True})
        )
        assert worker.run_once() is True
        assert failure.called

    @respx.mock
    def test_caps_the_frame_count_the_app_sends(self, worker):
        # The app decides how many frames to send, but trusting the other
        # side's bound is the habit this project keeps finding bugs in.
        respx.post(f"{API}/api/v1/clip-tagging/lease").mock(
            return_value=httpx.Response(
                200, json={"leaseId": "lease-4", "frames": [frame()] * 40}
            )
        )
        result = respx.post(f"{API}/api/v1/clip-tagging/result").mock(
            return_value=httpx.Response(200, json={"applied": True})
        )
        assert worker.run_once() is True
        assert result.called


class TestDiscipline:
    @respx.mock
    def test_logs_no_scores(self, worker, caplog):
        respx.post(f"{API}/api/v1/clip-tagging/lease").mock(
            return_value=httpx.Response(
                200, json={"leaseId": "lease-5", "frames": [frame()]}
            )
        )
        respx.post(f"{API}/api/v1/clip-tagging/result").mock(
            return_value=httpx.Response(200, json={"applied": True})
        )

        with caplog.at_level(logging.INFO, logger="clip_tagger.worker"):
            worker.run_once()

        logged = " ".join(record.getMessage() for record in caplog.records)
        assert "lease-5" in logged
        assert "frames=1" in logged
        # A score is a machine-authored judgement about one child's video.
        scores = worker._tagger.score([base64.b64decode(frame())])
        for value in scores.values():
            assert f"{value:.6f}" not in logged

    @respx.mock
    def test_stop_is_honoured_without_finishing_the_idle_wait(self, worker):
        respx.post(f"{API}/api/v1/clip-tagging/lease").mock(
            return_value=httpx.Response(204)
        )
        worker.stop()
        # run_forever must return promptly rather than sleeping out an
        # interval; Kubernetes' grace period is finite.
        worker.run_forever()
