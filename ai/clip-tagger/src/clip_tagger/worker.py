"""The pull worker: reaches out to the app cluster, asks for work, reports back.

The owner chose this topology on 2026-08-12 (option 2) because the GPU
cluster has no public address and getting one is an infrastructure request.
So the direction is inverted from the original design: **this cluster
initiates, and the app cluster never calls in.**

What that buys, and it is not nothing: the GPU cluster needs no ingress, no
certificate, no DNS record and no inbound port at all. Its attack surface
from the internet is zero, because nothing can reach it.

What it costs, stated here because whoever maintains this should not have
to reconstruct it: this process holds a credential to the app cluster and
has a route in. A compromised GPU pod is no longer sealed in a namespace
with egress denied — it can talk to `api.skillstreak.xyz`. The
compensating controls all live on the app side (the worker is handed a
random lease id instead of a clip id, cannot request a specific clip, and
cannot browse anything), which is the right place for them: they must hold
even if this process is entirely hostile.

Discipline this process keeps, for the same reasons the HTTP service does:

- **Retains nothing.** Frames are decoded into a local, scored, and
  dropped. Nothing is written to disk.
- **Logs no frames and no scores.** A score is a machine-authored
  judgement about one child's video; it belongs in the app's database
  behind its access rules, not in this cluster's log stream. The lease id
  is logged, and it identifies nothing on its own.
- **Fails safe.** Any error scoring a clip is reported back so the lease is
  released promptly, rather than left to time out.
"""

from __future__ import annotations

import base64
import binascii
import logging
import os
import random
import signal
import time
from dataclasses import dataclass

import httpx

from .model import Tagger, build_tagger

logger = logging.getLogger("clip_tagger.worker")


@dataclass(frozen=True)
class WorkerConfig:
    api_url: str
    token: str
    idle_sleep_seconds: float
    error_sleep_seconds: float
    request_timeout_seconds: float
    max_frames: int

    @staticmethod
    def from_env() -> WorkerConfig:
        api_url = os.environ.get("CLIP_TAGGING_API_URL", "").strip().rstrip("/")
        token = os.environ.get("CLIP_TAGGING_WORKER_TOKEN", "").strip()

        # Both required, and absent is a refusal to start rather than a
        # quiet no-op. A worker that comes up and polls nothing looks
        # healthy in every dashboard while doing no work at all.
        if not api_url:
            raise RuntimeError("CLIP_TAGGING_API_URL is not set.")
        if not token:
            raise RuntimeError("CLIP_TAGGING_WORKER_TOKEN is not set.")
        if not api_url.startswith("https://"):
            # The credential and the frames both cross the public internet
            # under this topology. Plain HTTP is not a degraded mode here.
            raise RuntimeError(
                f"CLIP_TAGGING_API_URL must be https:// (got {api_url!r})."
            )

        return WorkerConfig(
            api_url=api_url,
            token=token,
            idle_sleep_seconds=float(
                os.environ.get("CLIP_TAGGING_IDLE_SLEEP", "30")
            ),
            error_sleep_seconds=float(
                os.environ.get("CLIP_TAGGING_ERROR_SLEEP", "60")
            ),
            request_timeout_seconds=float(
                os.environ.get("CLIP_TAGGING_HTTP_TIMEOUT", "120")
            ),
            max_frames=int(os.environ.get("CLIP_TAGGER_MAX_FRAMES", "16")),
        )


class Worker:
    def __init__(self, config: WorkerConfig, tagger: Tagger) -> None:
        self._config = config
        self._tagger = tagger
        self._stopping = False
        self._client = httpx.Client(
            base_url=config.api_url,
            headers={"Authorization": f"Bearer {config.token}"},
            timeout=config.request_timeout_seconds,
        )

    def stop(self, *_args: object) -> None:
        """Finish the clip in hand, then exit. A SIGTERM mid-scoring should
        not orphan a lease that the app cluster then has to time out."""
        logger.info("stop requested; finishing the current clip")
        self._stopping = True

    def run_forever(self) -> None:
        signal.signal(signal.SIGTERM, self.stop)
        signal.signal(signal.SIGINT, self.stop)

        logger.info(
            "worker starting: api=%s model=%s prompts=%s gpu=%s",
            self._config.api_url,
            self._tagger.model_id,
            self._tagger.prompt_set.version,
            self._tagger.on_gpu,
        )

        while not self._stopping:
            try:
                did_work = self.run_once()
            except Exception:
                # Deliberately broad, and deliberately without the payload:
                # `exc_info` prints the traceback, which is about this
                # process, not about any clip. A crash loop here would be a
                # worse outcome than a slow retry, because the pod would
                # restart and reload the model every time.
                logger.exception("poll cycle failed")
                self._sleep(self._config.error_sleep_seconds)
                continue

            if not did_work:
                # Jittered, so a restarted fleet does not synchronise into
                # a thundering herd against one API pod.
                self._sleep(
                    self._config.idle_sleep_seconds * (0.5 + random.random())
                )

    def run_once(self) -> bool:
        """One lease-score-report cycle. True if there was work to do."""
        response = self._client.post("/api/v1/clip-tagging/lease")

        if response.status_code == 204:
            return False
        response.raise_for_status()

        payload = response.json()
        lease_id = payload["leaseId"]
        encoded = payload.get("frames") or []

        if len(encoded) > self._config.max_frames:
            # The app decides how many frames to send, but a runaway count
            # would put arbitrary memory into this process. Trusting the
            # other side's bound is exactly the habit this project keeps
            # finding bugs in.
            logger.warning(
                "lease %s carried %d frames, capping at %d",
                lease_id,
                len(encoded),
                self._config.max_frames,
            )
            encoded = encoded[: self._config.max_frames]

        try:
            frames = [base64.b64decode(item, validate=True) for item in encoded]
        except (binascii.Error, ValueError):
            logger.warning("lease %s carried undecodable frames", lease_id)
            self._report_failure(lease_id)
            return True

        if not frames:
            self._report_failure(lease_id)
            return True

        started = time.monotonic()
        try:
            scores = self._tagger.score(frames)
        except Exception:
            # Report rather than swallow: the app releases the lease
            # immediately instead of waiting out its TTL, and the attempt
            # is already counted so a clip that always fails converges.
            logger.exception("scoring failed for lease %s", lease_id)
            self._report_failure(lease_id)
            return True

        duration_ms = int((time.monotonic() - started) * 1000)

        result = self._client.post(
            "/api/v1/clip-tagging/result",
            json={
                "leaseId": lease_id,
                "scores": [
                    {"tag": tag, "score": round(score, 6)}
                    for tag, score in sorted(
                        scores.items(), key=lambda item: item[1], reverse=True
                    )
                ],
                "modelId": self._tagger.model_id,
                "promptSetVersion": self._tagger.prompt_set.version,
            },
        )
        result.raise_for_status()

        # Lease id, counts, timing. No scores — see the module docstring.
        logger.info(
            "scored lease=%s frames=%d duration_ms=%d",
            lease_id,
            len(frames),
            duration_ms,
        )
        return True

    def _report_failure(self, lease_id: str) -> None:
        try:
            self._client.post(
                "/api/v1/clip-tagging/failure", json={"leaseId": lease_id}
            ).raise_for_status()
        except (httpx.HTTPError, OSError):
            # The lease will time out on its own. Worth a line, not worth
            # crashing the loop over. Narrowed to transport errors: a bug
            # in this function should surface, not be swallowed as "the
            # network was unhappy".
            logger.warning("could not report failure for lease %s", lease_id)

    def _sleep(self, seconds: float) -> None:
        # Short slices so SIGTERM is honoured promptly instead of after a
        # full idle interval — Kubernetes' grace period is finite and a pod
        # that ignores it gets killed mid-request.
        deadline = time.monotonic() + seconds
        while not self._stopping and time.monotonic() < deadline:
            time.sleep(min(1.0, deadline - time.monotonic()))


def main() -> None:
    logging.basicConfig(
        level=os.environ.get("CLIP_TAGGER_LOG_LEVEL", "INFO").upper(),
        format="%(levelname)s:     %(name)s %(message)s",
    )
    config = WorkerConfig.from_env()
    # Model first: a pod that cannot load its weights must fail before it
    # ever claims a lease, or it will claim and drop clips in a loop.
    Worker(config, build_tagger()).run_forever()


if __name__ == "__main__":
    main()
