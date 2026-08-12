# The clip-tagger image.
#
# One image, environment-agnostic. It holds no URL of ours, serves no HTML
# and links to nothing, so CLAUDE.md's per-environment image rule — which
# exists because Metro bakes absolute URLs into static files at build time
# — does not apply. The pointer is runtime config: CLIP_TAGGING_API_URL in
# the cluster's ConfigMap, the token in its Secret.
#
# **Genuinely two stages**, because the single-stage version measured 11 GB
# against 5.7 GB of actual content: `uv` keeps a package cache, and with
# `UV_LINK_MODE=copy` every wheel is stored twice — once in the cache layer
# and once in the venv. Copying only the finished venv and the baked
# weights into a clean runtime leaves the cache behind in a discarded
# stage. What remains is irreducible: CUDA is ~2.7 GB and torch ~1.2 GB,
# and a GPU workload needs both.

FROM python:3.12-slim AS builder

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

# Weights are baked rather than fetched at boot: egress is denied by
# NetworkPolicy, so a pod that needed to download at startup would never
# become Ready. Overridable for a model swap without a code change.
ARG CLIP_TAGGER_MODEL_ID=google/siglip-base-patch16-224
ENV HF_HOME=/opt/hf-cache

# `.venv/bin/python`, never `uv run`. `uv run` re-syncs the project before
# executing, which here means trying to install the dev group that
# `--no-dev` deliberately left out — this build failed on pytest's
# `iniconfig`. The same trap is worse at runtime: the pod runs with egress
# denied, so a `uv run` entrypoint would attempt a sync it cannot perform
# and the container would never start. Calling the interpreter directly
# removes both.
RUN CLIP_TAGGER_MODEL_ID="${CLIP_TAGGER_MODEL_ID}" /app/.venv/bin/python -c "\
from transformers import AutoModel, AutoProcessor; \
import os; m = os.environ['CLIP_TAGGER_MODEL_ID']; \
AutoProcessor.from_pretrained(m); AutoModel.from_pretrained(m); \
print('weights baked:', m)"


FROM python:3.12-slim AS runtime

ENV PYTHONUNBUFFERED=1

# Non-root, matching the `restricted` PodSecurity this cluster enforces.
# The manifest sets runAsNonRoot/runAsUser as well — both, because the
# image should be safe to run anywhere, not only under a manifest that
# remembers to constrain it.
RUN useradd --uid 10001 --create-home --shell /usr/sbin/nologin tagger

WORKDIR /app

# The venv carries absolute paths from the builder, so /app must match.
# Only these three: no uv, no build toolchain, no package cache.
COPY --from=builder --chown=10001:10001 /app/.venv /app/.venv
COPY --from=builder --chown=10001:10001 /app/src /app/src
COPY --from=builder --chown=10001:10001 /opt/hf-cache /opt/hf-cache

USER 10001

ARG CLIP_TAGGER_MODEL_ID=google/siglip-base-patch16-224
ENV CLIP_TAGGER_MODEL_ID=${CLIP_TAGGER_MODEL_ID} \
    HF_HOME=/opt/hf-cache \
    HF_HUB_OFFLINE=1 \
    PYTHONPATH=/app/src

# Stamped at build, reported at /health. This is what lets a running pod be
# asked what it actually is rather than what someone believes was deployed
# — the check CLAUDE.md credits with catching the 2026-07-30 wrong-image
# incident.
ARG SERVICE_VERSION=dev
ENV SERVICE_VERSION=${SERVICE_VERSION}

EXPOSE 8000

# The HTTP service is the default entrypoint; the pull worker overrides it
# with `command:` in k8s-ai/clip-tagger.yaml. Same image, same scoring
# core — a topology change never means a second model implementation.
#
# One worker process. The model occupies GPU memory per process, and the
# binding constraint on these nodes is host RAM (~7.6 GB), not GPU cores.
CMD ["/app/.venv/bin/uvicorn", "clip_tagger.main:app", \
     "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
