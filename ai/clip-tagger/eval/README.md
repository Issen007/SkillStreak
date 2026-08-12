# Stage 0b — measuring the tagger before it ever sees a child

This harness answers "is this model good enough to be worth running" on
clips that contain **no user of this app**, before the pipeline is pointed
at a single real one.

## The fixtures contain no child of this app, and are never committed

`eval/fixtures/` is gitignored. Nothing in it is committed, ever.

Two reasons, and the second is the one that matters:

1. Video files do not belong in a git repository.
2. **A labelled corpus of children's training video is a far more
   sensitive artifact than any single clip.** The clips in this app are
   held inside closed team bubbles under a parental-consent flow; a folder
   of them sitting on a laptop next to a CSV of labels is outside every
   control that makes the app's handling of them acceptable. That is true
   even for the person who runs this repository.

So the fixture set is sourced from material that is **not** app data:
publicly-licensed floorball footage, recordings the owner makes
deliberately for this purpose with adults, or clips of the owner
themselves. If a fixture cannot be described in one sentence that makes
its provenance obvious, it does not go in the set.

## What to measure, and what "good enough" means

Run against a fixture set covering all eight vocabulary values:

```
uv run python eval/run_fixtures.py --frames 8 --url http://localhost:8000
```

It prints a confusion matrix and, per Decision 6's priority order:

1. **False-confident rate** — how often a wrong tag scores above the
   threshold. This is the number that matters most, because a wrong tag is
   a machine-authored claim about a child's video, and the whole design
   treats that as the expensive failure.
2. **Coverage** — how often the top score clears the threshold at all. Low
   coverage is disappointing; high false-confidence is harmful. Prefer
   low coverage.
3. Per-tag precision and recall.
4. Latency per clip on the real hardware.

There is deliberately no single pass/fail number here. The threshold is a
product knob in backend config, and the point of this harness is to let
someone choose it with the matrix in front of them rather than guess.

## What this does not measure

Anything about safety, abuse, nudity, age or faces. Decision 3 refuses to
build that classifier, so there is nothing here to evaluate — and if a
future change adds one, it needs its own ADR, its own review, its own
consent disclosure, and its own evaluation with a different shape.
