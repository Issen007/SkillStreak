# clip-tagger

Scores a handful of sampled frames against a versioned prompt set and
returns how likely each of eight **training types** is. That is all it
does.

Design: `docs/design/gpu-video-tagging-architecture.md`.

## What it is not

It is **not** a safety, abuse, nudity, age or face classifier, and
Decision 3 refuses to build one here by accident. `unclear_or_unrelated`
is a score like any other; the API maps it to "no confident tags" and
never writes it as a row, because a stored `unclear_or_unrelated` would be
a durable machine-authored negative judgement attached to one child's
video.

## The four properties that matter

- **Retains nothing.** Frames live in request-scoped locals. No disk, no
  cache, no queue. `readOnlyRootFilesystem` and `emptyDir` mounts make it
  a filesystem fact rather than a promise.
- **Reaches nothing.** No outbound call exists in the code, and the
  NetworkPolicy denies egress apart from DNS.
- **Logs no payload and no scores.** One line per request carrying
  `requestId` (a fresh UUID, never the clip id), a frame count and a
  duration. A score is a judgement about a child's video and belongs in
  the app's database behind its access rules, not in this cluster's logs.
- **Cannot lie about what it is.** `/health` reports the baked
  `SERVICE_VERSION`, the real `modelId`, the prompt-set version, and
  whether it actually has a GPU.

## Running it locally

```bash
cd ai/clip-tagger
uv sync --group dev

CLIP_TAGGER_BACKEND=stub CLIP_TAGGER_TOKEN=dev-token \
  uv run uvicorn clip_tagger.main:app --port 8000
```

`CLIP_TAGGER_BACKEND=stub` returns deterministic scores derived from the
image bytes, so everything except inference can be exercised without
2.5 GB of torch wheels. **It is not a fallback**: the real backend failing
to load stops the service rather than quietly serving fake judgements, and
selecting the stub takes an explicit env var. `/health` then reports
`modelId: "stub"`, so a running pod can never misrepresent itself.

For the real thing, `uv sync --extra model` and drop the backend variable.

## Configuration

| Variable | Default | Notes |
|---|---|---|
| `CLIP_TAGGER_TOKEN` | — | **Required.** Absent, the service refuses to start. |
| `CLIP_TAGGER_BACKEND` | `siglip` | Or `stub`. Unknown values are an error, not a default. |
| `CLIP_TAGGER_MODEL_ID` | `google/siglip-base-patch16-224` | Baked into the image. |
| `CLIP_TAGGER_PROMPT_SET` | `floorball-v1` | Indexes a file in `prompts/`. |
| `CLIP_TAGGER_MAX_BODY_BYTES` | 8 MiB | |
| `CLIP_TAGGER_MAX_FRAMES` | 16 | |
| `CLIP_TAGGER_RATE_LIMIT` | 60 | Per process, per window. |
| `SERVICE_VERSION` | `dev` | Set at build; reported at `/health`. |

## Changing the prompts

A prompt edit is a **new version** (`floorball-v2`), never an edit in
place. Scores are not comparable across wordings, and a silent edit makes
two runs look like a model regression rather than a different question.
The version travels on every response.

## Deploying

Not yet possible: the GPU cluster has no route. See
`k8s-ai/README.md` under "The route".
