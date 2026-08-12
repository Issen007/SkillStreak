"""Contract, auth and limit tests.

These run against the stub backend, so they exercise every path in the
service except the inference itself — auth, validation, limits, the
response shape and the logging discipline. The model's accuracy is not
testable here and is Stage 0b's job on the real hardware.
"""

from __future__ import annotations

import io
import json
import logging
import uuid

import pytest
from fastapi.testclient import TestClient

JPEG = b"\xff\xd8\xff" + b"\x00" * 64
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
TOKEN = "test-token-not-a-real-secret"


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("CLIP_TAGGER_BACKEND", "stub")
    monkeypatch.setenv("CLIP_TAGGER_TOKEN", TOKEN)
    monkeypatch.setenv("SERVICE_VERSION", "test-1.2.3")

    # Reload so module-level config picks up the patched environment.
    import importlib

    from clip_tagger import main

    importlib.reload(main)
    with TestClient(main.app) as test_client:
        yield test_client


def post_frames(client, frames, *, token=TOKEN, request_id=None, meta=None):
    files = [
        (f"frame{index}", (f"frame{index}.jpg", io.BytesIO(payload), "image/jpeg"))
        for index, payload in enumerate(frames)
    ]
    if meta is None:
        meta = json.dumps(
            {"requestId": request_id or str(uuid.uuid4()), "frameCount": len(frames)}
        )
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    return client.post(
        "/v1/analyse-frames", data={"meta": meta}, files=files, headers=headers
    )


class TestAuth:
    def test_rejects_a_missing_token(self, client):
        assert post_frames(client, [JPEG], token=None).status_code == 401

    def test_rejects_a_wrong_token(self, client):
        assert post_frames(client, [JPEG], token="wrong").status_code == 401

    def test_does_not_reach_the_model_before_auth(self, client, monkeypatch):
        # A body that would fail validation, with a bad token: the 401 must
        # win, so an unauthenticated caller learns nothing about what this
        # service would have accepted.
        response = client.post(
            "/v1/analyse-frames",
            data={"meta": "not json"},
            files=[("frame0", ("f.jpg", io.BytesIO(JPEG), "image/jpeg"))],
            headers={"Authorization": "Bearer wrong"},
        )
        assert response.status_code == 401

    def test_health_needs_no_token(self, client):
        assert client.get("/health").status_code == 200


class TestContract:
    def test_returns_all_eight_scores_descending(self, client):
        body = post_frames(client, [JPEG, JPEG]).json()
        scores = body["scores"]

        from clip_tagger.model import TAG_VALUES

        assert len(scores) == 8
        assert {row["tag"] for row in scores} == set(TAG_VALUES)
        values = [row["score"] for row in scores]
        assert values == sorted(values, reverse=True), "must be descending"

    def test_echoes_the_request_id_it_was_given(self, client):
        given = str(uuid.uuid4())
        assert post_frames(client, [JPEG], request_id=given).json()["requestId"] == given

    def test_reports_what_the_pod_actually_is(self, client):
        body = client.get("/health").json()
        assert body == {
            "status": "ok",
            "serviceVersion": "test-1.2.3",
            "modelId": "stub",
            "promptSetVersion": "floorball-v1",
            "gpu": False,
        }

    def test_the_stub_never_claims_to_be_a_real_model(self, client):
        # The response carries modelId too, so a score can be traced to the
        # thing that produced it without consulting /health separately.
        assert post_frames(client, [JPEG]).json()["modelId"] == "stub"

    def test_is_deterministic_for_the_same_frames(self, client):
        first = post_frames(client, [JPEG]).json()["scores"]
        second = post_frames(client, [JPEG]).json()["scores"]
        assert first == second

    def test_accepts_png_as_well_as_jpeg(self, client):
        assert post_frames(client, [PNG]).status_code == 200


class TestValidation:
    def test_rejects_a_non_uuid_request_id(self, client):
        # A caller bug that put the clip id here would write a stable
        # identifier for a child's video into this cluster's logs.
        response = post_frames(client, [JPEG], request_id="clip-42")
        assert response.status_code == 400

    def test_rejects_meta_that_is_not_json(self, client):
        assert post_frames(client, [JPEG], meta="hello").status_code == 400

    def test_rejects_meta_without_a_request_id(self, client):
        assert post_frames(client, [JPEG], meta=json.dumps({})).status_code == 400

    def test_rejects_no_frames(self, client):
        response = client.post(
            "/v1/analyse-frames",
            data={"meta": json.dumps({"requestId": str(uuid.uuid4())})},
            headers={"Authorization": f"Bearer {TOKEN}"},
        )
        assert response.status_code == 400

    def test_rejects_a_body_that_is_not_an_image(self, client):
        # Checked by magic bytes before the decoder sees it: the decoder is
        # the part with the CVE history.
        response = post_frames(client, [b"<html>not an image</html>"])
        assert response.status_code == 400
        assert "not a JPEG or PNG" in response.json()["detail"]

    def test_rejects_too_many_frames(self, client):
        assert post_frames(client, [JPEG] * 40).status_code == 400

    def test_rejects_an_oversized_body(self, client, monkeypatch):
        from clip_tagger import main

        monkeypatch.setattr(main, "MAX_BODY_BYTES", 100)
        assert post_frames(client, [JPEG * 100]).status_code == 413


class TestLimits:
    def test_rate_limits_a_flood(self, client, monkeypatch):
        from clip_tagger import main

        monkeypatch.setattr(main, "RATE_LIMIT_REQUESTS", 3)
        main._recent_requests.clear()

        codes = [post_frames(client, [JPEG]).status_code for _ in range(5)]
        assert codes.count(200) == 3
        assert codes.count(429) == 2


class TestDiscipline:
    def test_logs_no_payload_and_no_scores(self, client, caplog):
        # The log line is the one place request data could leak off this
        # cluster. It may carry the requestId, a count and a duration —
        # nothing about the picture and nothing about the judgement.
        given = str(uuid.uuid4())
        with caplog.at_level(logging.INFO, logger="clip_tagger"):
            body = post_frames(client, [JPEG, PNG], request_id=given).json()

        logged = " ".join(record.getMessage() for record in caplog.records)
        assert given in logged, "requestId is the intended correlation handle"
        assert "frames=2" in logged
        for row in body["scores"]:
            assert str(row["score"]) not in logged, "a score is a judgement"
        assert "frame0.jpg" not in logged, "no filenames"

    def test_exposes_no_docs_routes(self, client):
        # Nothing here is for browsing, and an OpenAPI schema on a service
        # holding derived frames of children is an invitation.
        for path in ("/docs", "/redoc", "/openapi.json"):
            assert client.get(path).status_code == 404


class TestStartup:
    def test_refuses_to_start_without_a_token(self, monkeypatch):
        # An unauthenticated tagger is not a degraded mode, it is a
        # different service. This repo has shipped "env var absent, feature
        # silently changed shape" before.
        monkeypatch.delenv("CLIP_TAGGER_TOKEN", raising=False)
        monkeypatch.setenv("CLIP_TAGGER_BACKEND", "stub")

        import importlib

        from clip_tagger import main

        importlib.reload(main)
        with (
            pytest.raises(RuntimeError, match="CLIP_TAGGER_TOKEN"),
            TestClient(main.app),
        ):
            pass

    def test_refuses_an_unknown_backend(self, monkeypatch):
        # A typo in a ConfigMap must not silently downgrade a GPU pod to
        # fake scores.
        monkeypatch.setenv("CLIP_TAGGER_BACKEND", "sigplip")
        monkeypatch.setenv("CLIP_TAGGER_TOKEN", TOKEN)

        from clip_tagger.model import build_tagger

        with pytest.raises(ValueError, match="Unknown CLIP_TAGGER_BACKEND"):
            build_tagger()


class TestLoggingIsActuallyEmitted:
    """The regression that `caplog.at_level` hid.

    `TestDiscipline` forces the level, so it proves the call happens and
    what it contains — not that a running process would emit it. Uvicorn
    configures its own loggers and leaves third-party ones at the root
    default of WARNING, so the requestId line was silent in the real
    service while the suite stayed green. Found by reading the running
    process's output.
    """

    def test_the_logger_is_at_info_after_startup(self, client):
        import logging

        assert logging.getLogger("clip_tagger").isEnabledFor(logging.INFO)

    def test_the_request_line_is_emitted_without_forcing_the_level(self, client, caplog):
        # `caplog` with no `at_level`: pytest attaches a handler but does
        # not change any logger's own level, so a logger left at WARNING
        # never creates the INFO record and this stays empty. That is
        # exactly the bug, expressed as a test.
        given = str(uuid.uuid4())
        post_frames(client, [JPEG], request_id=given)
        assert any(given in record.getMessage() for record in caplog.records)


class TestRejectsBeforeReadingTheBody:
    """Auth and the size cap are decided from headers, before parsing.

    Invisible from the response alone — a 401 looks identical whether the
    body was spooled to disk first or not. Declaring `meta` as a `Form()`
    parameter made FastAPI resolve it *before* entering the handler, so an
    unauthenticated caller got their whole multipart body parsed and
    spooled before being rejected. These pin the ordering.
    """

    def test_does_not_parse_the_body_of_an_unauthenticated_request(
        self, client, monkeypatch
    ):
        import starlette.requests

        parsed = []
        original = starlette.requests.Request.form

        def spy(self, *args, **kwargs):
            parsed.append(True)
            return original(self, *args, **kwargs)

        monkeypatch.setattr(starlette.requests.Request, "form", spy)

        assert post_frames(client, [JPEG], token="wrong").status_code == 401
        assert not parsed, "the body must not be parsed before auth fails"

    def test_rejects_an_oversized_declared_body_before_parsing(
        self, client, monkeypatch
    ):
        import starlette.requests

        from clip_tagger import main

        parsed = []
        original = starlette.requests.Request.form
        monkeypatch.setattr(
            starlette.requests.Request,
            "form",
            lambda self, *a, **k: (parsed.append(True), original(self, *a, **k))[1],
        )
        monkeypatch.setattr(main, "MAX_BODY_BYTES", 10)

        # Content-Length is set by the client, so this is the honest
        # caller's cheap rejection — the real cap is still enforced on
        # bytes actually read.
        assert post_frames(client, [JPEG]).status_code == 413
        assert not parsed, "an over-declared body must not be parsed at all"

    def test_an_unauthenticated_flood_does_not_exhaust_the_rate_limit(
        self, client, monkeypatch
    ):
        # Rate limiting runs after auth, so an attacker cannot spend the
        # one legitimate caller's budget.
        from clip_tagger import main

        monkeypatch.setattr(main, "RATE_LIMIT_REQUESTS", 3)
        main._recent_requests.clear()

        for _ in range(20):
            assert post_frames(client, [JPEG], token="wrong").status_code == 401
        assert post_frames(client, [JPEG]).status_code == 200
