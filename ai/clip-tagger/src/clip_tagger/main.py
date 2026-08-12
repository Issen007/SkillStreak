"""The clip-tagger HTTP service.

Two routes and nothing else, per the contract in
docs/design/gpu-video-tagging-architecture.md (Decision 7):

    POST /v1/analyse-frames   multipart: meta + frame0..frameN
    GET  /health

What this service must never do, and the reasons, because they are the
whole point of running it in a separate cluster with egress denied:

- **Retain nothing.** Frames live in request-scoped locals and are gone
  when the response is written. No disk, no cache, no queue, no metrics
  labelled by anything request-specific. Decision 12 priced statelessness
  and chose it deliberately.
- **Log no payload.** Not the frames, not their sizes per frame, not the
  meta blob. The access log records method, path, status and duration —
  and `requestId`, which is a fresh UUID per request and never the clip
  id, so the GPU cluster's logs carry no stable identifier for any child's
  video (Decision 7).
- **Reach nothing.** Egress is denied by NetworkPolicy. There is no
  outbound call in this file, and adding one would be a design change, not
  a refactor.
- **Judge nobody.** This scores training type. It is not a safety, abuse,
  nudity, age or face classifier, and Decision 3 refuses to build one here
  by accident. `unclear_or_unrelated` is a score like any other and the
  API never persists it as a row.
"""

from __future__ import annotations

import json
import logging
import os
import time
import uuid
from collections import deque
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse

# Starlette's UploadFile, not FastAPI's subclass of it: `request.form()`
# yields the base class, so an isinstance check against the subclass
# silently matches nothing and every frame is dropped as "not a file".
from starlette.datastructures import UploadFile

from .model import TAG_VALUES, Tagger, build_tagger

logger = logging.getLogger("clip_tagger")

# Uvicorn installs its own handlers and does not touch third-party loggers,
# so without this `clip_tagger` sits at the root default of WARNING and the
# one line below that carries `requestId` is never emitted. Found by
# reading the running process's output rather than the test suite — the
# unit test forced the level with `caplog.at_level` and so proved only that
# the call happens, not that anyone would ever see it.
def _configure_logging() -> None:
    level = os.environ.get("CLIP_TAGGER_LOG_LEVEL", "INFO").strip().upper()
    logger.setLevel(getattr(logging, level, logging.INFO))
    if not logger.handlers and not logging.getLogger().handlers:
        handler = logging.StreamHandler()
        handler.setFormatter(
            logging.Formatter("%(levelname)s:     %(name)s %(message)s")
        )
        logger.addHandler(handler)

SERVICE_VERSION = os.environ.get("SERVICE_VERSION", "dev")

# Numbers, not mechanisms — the same "mechanisms fixed, numbers free" split
# ADR-0010 established. Every one of these is env-tunable without a new
# design doc, and every default is the conservative end.
MAX_BODY_BYTES = int(os.environ.get("CLIP_TAGGER_MAX_BODY_BYTES", str(8 * 1024 * 1024)))
MAX_FRAMES = int(os.environ.get("CLIP_TAGGER_MAX_FRAMES", "16"))
RATE_LIMIT_REQUESTS = int(os.environ.get("CLIP_TAGGER_RATE_LIMIT", "60"))
RATE_LIMIT_WINDOW_SECONDS = float(
    os.environ.get("CLIP_TAGGER_RATE_LIMIT_WINDOW", "60")
)

# JPEG and PNG magic bytes. Checked before the decoder sees anything, so a
# non-image body is refused by a comparison rather than by Pillow's parser
# — the parser is the part with the CVE history, and the cheapest way to
# not be exposed to it is to hand it less.
_IMAGE_MAGIC = (
    b"\xff\xd8\xff",      # JPEG
    b"\x89PNG\r\n\x1a\n",  # PNG
)

@asynccontextmanager
async def _lifespan(_app: FastAPI):
    """Load the model before the port is bound.

    A pod that cannot load its weights must never become Ready — otherwise
    it fails on the first real clip instead of at rollout, which is the
    difference between a failed deploy and a silently degraded feature.
    """
    global _tagger
    _configure_logging()
    _expected_token()  # fail fast, before anything is served
    _tagger = build_tagger()
    logger.info(
        "clip-tagger ready: service_version=%s model_id=%s prompt_set=%s gpu=%s",
        SERVICE_VERSION,
        _tagger.model_id,
        _tagger.prompt_set.version,
        _tagger.on_gpu,
    )
    yield


app = FastAPI(
    lifespan=_lifespan,
    title="SkillStreak clip-tagger",
    docs_url=None,      # No interactive docs on a service holding derived
    redoc_url=None,     # frames of children. Nothing here is for browsing.
    openapi_url=None,
)

# Populated at startup. Module-level because the model is the process's one
# expensive resource and is shared across requests read-only.
_tagger: Tagger | None = None

# Naive fixed-window rate limit, per process. Deliberately not per-token or
# per-IP: there is exactly one legitimate caller (the app cluster's API
# pod), so a global ceiling is the honest shape and needs no state about
# who called. Replicas each get their own window, which makes the effective
# limit `replicas x RATE_LIMIT_REQUESTS` — stated here rather than
# discovered later.
_recent_requests: deque[float] = deque()


def _expected_token() -> str:
    token = os.environ.get("CLIP_TAGGER_TOKEN", "")
    if not token:
        # Refusing to start is the point: a service that holds children's
        # frames must never come up accepting anonymous requests because a
        # Secret key was missing. This repo has hit the "env var absent, so
        # the feature silently changed shape" failure before.
        raise RuntimeError(
            "CLIP_TAGGER_TOKEN is not set. The service will not start "
            "without it — an unauthenticated tagger is not a degraded "
            "mode, it is a different service."
        )
    return token





def _require_token(request: Request) -> None:
    header = request.headers.get("authorization", "")
    scheme, _, presented = header.partition(" ")
    expected = _expected_token()

    # Constant-time compare. The token is the only thing standing between
    # the internet and this cluster's GPUs, and a length-or-prefix leak is
    # free to avoid.
    import hmac

    if scheme.lower() != "bearer" or not hmac.compare_digest(presented, expected):
        # No detail about which part failed, and no logging of what was
        # presented.
        raise HTTPException(status_code=401, detail="Unauthorized")


def _check_rate_limit() -> None:
    now = time.monotonic()
    cutoff = now - RATE_LIMIT_WINDOW_SECONDS
    while _recent_requests and _recent_requests[0] < cutoff:
        _recent_requests.popleft()
    if len(_recent_requests) >= RATE_LIMIT_REQUESTS:
        raise HTTPException(status_code=429, detail="Too many requests")
    _recent_requests.append(now)


@app.get("/health")
def health() -> JSONResponse:
    """Ask a running pod what it actually is.

    Unauthenticated on purpose: it is the kubelet's probe target and it
    reveals nothing about any clip, any child, or the token. It reports
    what the pod IS, which is exactly the check that catches a wrong image
    being live — the failure this project has already had once in
    production.
    """
    if _tagger is None:
        return JSONResponse({"status": "starting"}, status_code=503)
    return JSONResponse(
        {
            "status": "ok",
            "serviceVersion": SERVICE_VERSION,
            "modelId": _tagger.model_id,
            "promptSetVersion": _tagger.prompt_set.version,
            "gpu": _tagger.on_gpu,
        }
    )


@app.post("/v1/analyse-frames")
async def analyse_frames(request: Request) -> JSONResponse:
    # `meta` is read from the parsed form BELOW rather than declared as a
    # `Form()` parameter, and that ordering is the point: FastAPI resolves
    # declared parameters before entering the handler, so a `Form()`
    # signature makes Starlette parse — and spool to disk — the entire
    # multipart body of an UNAUTHENTICATED request before this function
    # runs and rejects it. Auth and the size cap are decided from headers
    # alone, before a byte of the body is touched.
    _require_token(request)

    # Content-Length is advisory — a chunked body has none — so the real
    # cap is enforced on the bytes actually read, further down. This is the
    # cheap rejection, and it happens before any parsing.
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > MAX_BODY_BYTES:
        raise HTTPException(status_code=413, detail="Body too large")

    # After auth, so an unauthenticated flood cannot exhaust the budget and
    # deny service to the one legitimate caller.
    _check_rate_limit()

    form = await request.form()
    meta = form.get("meta")
    if not isinstance(meta, str):
        raise HTTPException(
            status_code=400, detail="meta must be JSON with a requestId"
        )

    try:
        parsed = json.loads(meta)
        request_id = str(parsed["requestId"])
    except (json.JSONDecodeError, KeyError, TypeError) as error:
        raise HTTPException(
            status_code=400, detail="meta must be JSON with a requestId"
        ) from error

    # The caller mints a fresh UUID v4 per request and never the clip id
    # (Decision 7). Validated rather than trusted: this value is the one
    # request-specific thing that reaches this cluster's logs, so a caller
    # bug that put a clip id here would otherwise write a stable
    # identifier for a child's video into them.
    try:
        uuid.UUID(request_id)
    except ValueError as error:
        raise HTTPException(
            status_code=400, detail="requestId must be a UUID"
        ) from error

    uploads = [
        value
        for key, value in form.multi_items()
        if key.startswith("frame") and isinstance(value, UploadFile)
    ]
    if not uploads:
        raise HTTPException(status_code=400, detail="No frames supplied")
    if len(uploads) > MAX_FRAMES:
        raise HTTPException(status_code=400, detail="Too many frames")

    frames: list[bytes] = []
    total = 0
    for upload in uploads:
        payload = await upload.read()
        total += len(payload)
        if total > MAX_BODY_BYTES:
            raise HTTPException(status_code=413, detail="Body too large")
        if not payload.startswith(_IMAGE_MAGIC):
            # Position, not content: naming which frame is wrong helps the
            # caller debug and says nothing about the picture.
            raise HTTPException(
                status_code=400,
                detail=f"frame {len(frames)} is not a JPEG or PNG",
            )
        frames.append(payload)

    assert _tagger is not None  # startup guarantees this
    started = time.monotonic()
    scores = _tagger.score(frames)
    duration_ms = int((time.monotonic() - started) * 1000)

    # requestId, count and timing. No filenames, no sizes per frame, no
    # scores — a score IS a machine-authored judgement about one child's
    # video, and it belongs in the app's database behind its access rules,
    # not in this cluster's log stream.
    logger.info(
        "analysed request_id=%s frames=%d duration_ms=%d",
        request_id,
        len(frames),
        duration_ms,
    )

    return JSONResponse(
        {
            "requestId": request_id,
            "serviceVersion": SERVICE_VERSION,
            "modelId": _tagger.model_id,
            "promptSetVersion": _tagger.prompt_set.version,
            # All eight, always, descending. Thresholding is the app's job
            # because the threshold is a product knob that must be tunable
            # in backend config without rebuilding a GPU image.
            "scores": [
                {"tag": tag, "score": round(score, 6)}
                for tag, score in sorted(
                    scores.items(), key=lambda item: item[1], reverse=True
                )
            ],
        }
    )


# Sanity: the response above claims every tag is present. If the vocabulary
# and the scorer ever disagree, that is a startup-time bug, not a per-clip
# surprise.
assert len(TAG_VALUES) == 8
