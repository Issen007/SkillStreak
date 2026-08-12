# The clip-tagger image.
#
# One image, environment-agnostic (Decision 9). It holds no URL of ours,
# serves no HTML and links to nothing, so CLAUDE.md's per-environment image
# rule — which exists because Metro bakes absolute URLs into static files
# at build time — does not apply. The pointer is runtime config:
# AI_TAGGING_URL/AI_TAGGING_TOKEN in each cluster's own ConfigMap/Secret.
#
# Two stages so the CUDA-sized model dependencies are installed once and
# the source layer stays cheap to rebuild.

FROM python:3.12-slim AS base

# uv, per ADR-0003. No pip or poetry lockfile alongside it.
COPY --from=ghcr.io/astral-sh/uv:0.5.11 /uv /usr/local/bin/uv

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never \
    PYTHONUNBUFFERED=1

WORKDIR /app

# Dependencies first, so a source-only change does not re-resolve or
# re-download torch.
COPY pyproject.toml uv.lock* ./
RUN uv sync --extra model --no-dev --no-install-project

COPY src/ ./src/
RUN uv sync --extra model --no-dev

# Non-root, matching the `restricted` PodSecurity this cluster enforces.
# The manifest sets runAsNonRoot/runAsUser as well — both, because the
# image should be safe to run anywhere, not only under a manifest that
# remembers to constrain it.
RUN useradd --uid 10001 --create-home --shell /usr/sbin/nologin tagger
USER 10001

# Stamped at build, reported at /health. This is what lets a running pod
# be asked what it actually is rather than what someone believes was
# deployed — the check CLAUDE.md credits with catching the 2026-07-30
# wrong-image incident.
ARG SERVICE_VERSION=dev
ENV SERVICE_VERSION=${SERVICE_VERSION}

# Weights are baked rather than fetched at boot: egress is denied by
# NetworkPolicy (Decision 4), so a pod that needed to download at startup
# would never become Ready. Overridable for a model swap without a code
# change.
ARG CLIP_TAGGER_MODEL_ID=google/siglip-base-patch16-224
ENV CLIP_TAGGER_MODEL_ID=${CLIP_TAGGER_MODEL_ID} \
    HF_HOME=/home/tagger/.cache/huggingface \
    HF_HUB_OFFLINE=1

RUN HF_HUB_OFFLINE=0 uv run python -c "\
from transformers import AutoModel, AutoProcessor; \
import os; m = os.environ['CLIP_TAGGER_MODEL_ID']; \
AutoProcessor.from_pretrained(m); AutoModel.from_pretrained(m); \
print('weights baked:', m)"

EXPOSE 8000

# One worker. The model occupies GPU memory per process, and the binding
# constraint on these nodes is host RAM (~7.6 GB), not GPU cores — a
# second worker would double the resident model for no throughput on a
# workload that is one batched request at a time.
CMD ["uv", "run", "uvicorn", "clip_tagger.main:app", \
     "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
