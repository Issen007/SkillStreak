"""The coach training-plan generator (ADR-0028 Phase 1).

Leases a job from the app cluster, builds a prompt from the drills the job
carries, generates a session plan, posts it back. Same pull shape as the
clip tagger, for the same reason: this cluster has no inbound route.

**It holds no corpus.** The drills arrive with the job, which keeps the
single copy in the app's repository where it is reviewable in a diff and —
ADR-0028 Decision 14's requirement — still exists if this cluster does
not. A worker with its own corpus copy is a worker whose corpus can drift
from the one the coaches actually edit.

**There is no retrieval step, deliberately.** The library is small enough
that the whole thing fits in the context window many times over, so the
app sends all of it. Retrieval over two documents can pick the wrong one;
sending everything structurally cannot. The seam for adding it later lives
on the app side (`TrainingPlansService.selectDrills`), not here.

Same discipline as the tagger: retains nothing, logs no prompt and no
generated text — a coach's prompt is their words and may, per ADR-0028
Decision 7(c), contain a child's name however much the design discourages
it. The lease id is logged and identifies nothing on its own.
"""

from __future__ import annotations

import logging
import os
import random
import signal
import time
from dataclasses import dataclass

import httpx

logger = logging.getLogger("clip_tagger.plan_generator")

# Bounded because a looping model can emit megabytes, and the app stores
# this in Postgres and renders it to a coach. Far more than a 90-minute
# session needs; far less than a runaway generation.
MAX_PLAN_CHARS = 20_000


@dataclass(frozen=True)
class GeneratorConfig:
    api_url: str
    token: str
    model_id: str
    idle_sleep_seconds: float
    error_sleep_seconds: float
    request_timeout_seconds: float
    max_new_tokens: int

    @staticmethod
    def from_env() -> GeneratorConfig:
        api_url = os.environ.get("TRAINING_PLAN_API_URL", "").strip().rstrip("/")
        token = os.environ.get("TRAINING_PLAN_WORKER_TOKEN", "").strip()

        if not api_url:
            raise RuntimeError("TRAINING_PLAN_API_URL is not set.")
        if not token:
            raise RuntimeError("TRAINING_PLAN_WORKER_TOKEN is not set.")
        if not api_url.startswith("https://"):
            raise RuntimeError(
                f"TRAINING_PLAN_API_URL must be https:// (got {api_url!r})."
            )

        return GeneratorConfig(
            api_url=api_url,
            token=token,
            # A 3B instruct model, chosen for the hardware rather than the
            # leaderboard: these nodes have ~7.6 GB of host RAM, which is
            # the binding constraint — not the A2's 15 GB of VRAM. Qwen2.5
            # is Apache-2.0, which matters because ADR-0028 Decision 1
            # rules out anything whose licence makes self-hosting murky.
            model_id=os.environ.get(
                "TRAINING_PLAN_MODEL_ID", "Qwen/Qwen2.5-3B-Instruct"
            ),
            idle_sleep_seconds=float(
                os.environ.get("TRAINING_PLAN_IDLE_SLEEP", "20")
            ),
            error_sleep_seconds=float(
                os.environ.get("TRAINING_PLAN_ERROR_SLEEP", "60")
            ),
            request_timeout_seconds=float(
                os.environ.get("TRAINING_PLAN_HTTP_TIMEOUT", "120")
            ),
            max_new_tokens=int(
                os.environ.get("TRAINING_PLAN_MAX_NEW_TOKENS", "1200")
            ),
        )


SYSTEM_PROMPT = {
    "sv": (
        "Du är en erfaren innebandytränare som planerar träningspass för "
        "barn och ungdomar. Du skriver korta, konkreta pass som en tränare "
        "kan följa direkt på plan.\n\n"
        "Regler:\n"
        "- Använd ENDAST övningarna nedan. Hitta inte på nya övningar.\n"
        "- Passet ska summera till ungefär den angivna längden.\n"
        "- Skriv för den angivna åldersgruppen.\n"
        "- Nämn aldrig namn på enskilda spelare.\n"
        "- Svara i Markdown: en rubrik, sedan en punktlista med tid per "
        "moment, sedan en kort rad med tips till tränaren."
    ),
    "en": (
        "You are an experienced floorball coach planning training sessions "
        "for children and youth. You write short, concrete sessions a coach "
        "can follow on the court.\n\n"
        "Rules:\n"
        "- Use ONLY the drills below. Do not invent new drills.\n"
        "- The session should add up to roughly the requested length.\n"
        "- Write for the given age band.\n"
        "- Never name individual players.\n"
        "- Answer in Markdown: a heading, then a bullet list with a time "
        "per item, then a short line of coaching tips."
    ),
}


def build_prompt(job: dict) -> tuple[str, str]:
    """(system, user). The whole corpus goes in the user turn.

    The 'use ONLY these drills' instruction is a soft constraint and is
    treated as one — ADR-0028 Decision 8 is explicit that the generator is
    advisory and a coach reads what it produces before using it. It is not
    a safety control and nothing downstream assumes it held.
    """
    locale = job.get("locale", "sv")
    system = SYSTEM_PROMPT.get(locale, SYSTEM_PROMPT["sv"])

    lines = []
    for drill in job.get("drills", []):
        lines.append(
            f"### {drill['title']}\n"
            f"(slug: {drill['slug']}, {drill['ageBand']}, "
            f"{drill['focus']}, {drill['durationMinutes']} min)\n"
            f"{drill['body']}\n"
        )
    corpus = "\n".join(lines) or "(no drills available)"

    focus = job.get("focus") or ("valfritt" if locale == "sv" else "any")
    if locale == "sv":
        user = (
            f"Tillgängliga övningar:\n\n{corpus}\n\n"
            f"Planera ett pass.\n"
            f"- Åldersgrupp: {job['ageBand']}\n"
            f"- Längd: {job['durationMinutes']} minuter\n"
            f"- Fokus: {focus}\n"
            f"- Tränarens önskemål: {job['promptText']}"
        )
    else:
        user = (
            f"Available drills:\n\n{corpus}\n\n"
            f"Plan a session.\n"
            f"- Age band: {job['ageBand']}\n"
            f"- Length: {job['durationMinutes']} minutes\n"
            f"- Focus: {focus}\n"
            f"- Coach's request: {job['promptText']}"
        )
    return system, user


class PlanModel:
    """The text model. Loaded once, before the port— before any lease."""

    def __init__(self, model_id: str, max_new_tokens: int) -> None:
        import torch
        from transformers import AutoModelForCausalLM, AutoTokenizer

        self.model_id = model_id
        self._max_new_tokens = max_new_tokens
        self._torch = torch
        self.on_gpu = torch.cuda.is_available()

        self._tokenizer = AutoTokenizer.from_pretrained(model_id)
        self._model = AutoModelForCausalLM.from_pretrained(
            model_id,
            # bfloat16 on GPU halves the resident weights against fp32 and
            # is what these nodes can actually hold; float32 on CPU because
            # bf16 on CPU is slower, not faster.
            dtype=torch.bfloat16 if self.on_gpu else torch.float32,
            device_map="cuda" if self.on_gpu else "cpu",
        ).eval()

    def generate(self, system: str, user: str) -> str:
        torch = self._torch
        messages = [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ]
        text = self._tokenizer.apply_chat_template(
            messages, tokenize=False, add_generation_prompt=True
        )
        inputs = self._tokenizer([text], return_tensors="pt").to(
            self._model.device
        )

        with torch.no_grad():
            generated = self._model.generate(
                **inputs,
                max_new_tokens=self._max_new_tokens,
                # Low but non-zero: a session plan should be reproducible
                # enough to trust and varied enough to be worth asking
                # twice. Greedy decoding on a small model tends to loop.
                temperature=0.6,
                top_p=0.9,
                do_sample=True,
                pad_token_id=self._tokenizer.eos_token_id,
            )

        # Only the newly generated tail — the prompt carries the coach's
        # words and the whole corpus, and echoing it back would store both
        # again in the app's database.
        completion = generated[0][inputs["input_ids"].shape[-1]:]
        return self._tokenizer.decode(
            completion, skip_special_tokens=True
        ).strip()[:MAX_PLAN_CHARS]


class PlanGenerator:
    def __init__(self, config: GeneratorConfig, model: PlanModel) -> None:
        self._config = config
        self._model = model
        self._stopping = False
        self._client = httpx.Client(
            base_url=config.api_url,
            headers={"Authorization": f"Bearer {config.token}"},
            timeout=config.request_timeout_seconds,
        )

    def stop(self, *_args: object) -> None:
        logger.info("stop requested; finishing the current plan")
        self._stopping = True

    def run_forever(self) -> None:
        signal.signal(signal.SIGTERM, self.stop)
        signal.signal(signal.SIGINT, self.stop)
        logger.info(
            "plan generator starting: api=%s model=%s gpu=%s",
            self._config.api_url,
            self._model.model_id,
            self._model.on_gpu,
        )

        while not self._stopping:
            try:
                did_work = self.run_once()
            except Exception:
                logger.exception("poll cycle failed")
                self._sleep(self._config.error_sleep_seconds)
                continue
            if not did_work:
                self._sleep(
                    self._config.idle_sleep_seconds * (0.5 + random.random())
                )

    def run_once(self) -> bool:
        response = self._client.post("/api/v1/training-plan-jobs/lease")
        if response.status_code == 204:
            return False
        response.raise_for_status()

        job = response.json()
        lease_id = job["leaseId"]
        started = time.monotonic()

        try:
            system, user = build_prompt(job)
            plan = self._model.generate(system, user)
        except Exception:
            logger.exception("generation failed for lease %s", lease_id)
            self._report_failure(lease_id)
            return True

        plan = plan.strip()
        if not plan:
            # Stripped HERE rather than trusting the model wrapper to have
            # done it: a whitespace-only completion is truthy, so `if not
            # plan` alone would store a blank page as a training session.
            # An empty completion is a failure, not a plan.
            logger.warning("empty completion for lease %s", lease_id)
            self._report_failure(lease_id)
            return True

        self._client.post(
            "/api/v1/training-plan-jobs/result",
            json={
                "leaseId": lease_id,
                "plan": plan,
                "modelId": self._model.model_id,
                "corpusVersion": job["corpusVersion"],
            },
        ).raise_for_status()

        # Lease id, sizes, timing. Never the prompt and never the plan:
        # the prompt is a coach's own words and may contain a name however
        # much the design discourages it, and the plan is derived from it.
        logger.info(
            "generated lease=%s drills=%d chars=%d duration_ms=%d",
            lease_id,
            len(job.get("drills", [])),
            len(plan),
            int((time.monotonic() - started) * 1000),
        )
        return True

    def _report_failure(self, lease_id: str) -> None:
        try:
            self._client.post(
                "/api/v1/training-plan-jobs/failure", json={"leaseId": lease_id}
            ).raise_for_status()
        except (httpx.HTTPError, OSError):
            logger.warning("could not report failure for lease %s", lease_id)

    def _sleep(self, seconds: float) -> None:
        deadline = time.monotonic() + seconds
        while not self._stopping and time.monotonic() < deadline:
            time.sleep(min(1.0, deadline - time.monotonic()))


def main() -> None:
    logging.basicConfig(
        level=os.environ.get("CLIP_TAGGER_LOG_LEVEL", "INFO").upper(),
        format="%(levelname)s:     %(name)s %(message)s",
    )
    config = GeneratorConfig.from_env()
    # Model first: a pod that cannot load its weights must fail before it
    # claims a lease, or it will claim and drop jobs in a loop.
    PlanGenerator(config, PlanModel(config.model_id, config.max_new_tokens)).run_forever()


if __name__ == "__main__":
    main()
