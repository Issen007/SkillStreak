# Stage 0b — measuring the tagger before it means anything

The tagger runs in production and is tagging clips. Nobody has established
that those tags are **correct**. This harness is how that gets answered,
and it answers one question:

> **What confidence threshold, if any, makes these tags worth storing?**

It prints a table rather than a verdict, because that is a product
decision. What it will not do is let you set a threshold without seeing
what the threshold costs.

## Setup

```bash
cd ai/clip-tagger
uv sync --extra model --extra eval
uv run python eval/run_fixtures.py --init
```

`--init` creates `fixtures/<tag>/` for all eight tags and a
`PROVENANCE.md` to fill in. `--extra eval` brings a bundled ffmpeg, so
there is no system install step.

Runs in-process, on CPU if that is what you have. There is deliberately
**no server to point at**: the deployed GPU pod is a pull worker with no
Service and `ingress: []`, so nothing is listening. ~1.3s per clip on CPU,
which for 40 clips is a minute.

## The one rule: no user of this app appears in these clips

Not a child on any team. Not a clip from the beta. Not a frame of anyone's
uploaded video.

A labelled corpus of children's training footage is a **far more sensitive
artifact than any single clip in the app**. The app's clips live inside
closed team bubbles under a parental-consent flow; a folder of them on a
laptop next to a file of labels sits outside every control that makes
handling them acceptable. That holds for the person who runs this
repository as much as anyone.

`fixtures/` is gitignored and nothing in it is ever committed.
`PROVENANCE.md` is the exception, and it exists to force one question per
clip: where did this come from, and may we use it?

Acceptable sources, and nothing else:

1. Footage you recorded yourself, with adults who agreed to this use.
2. Footage of yourself.
3. Openly-licensed material whose licence permits it — record licence and
   URL.

If a clip cannot be described in one sentence that makes its origin
obvious, it does not go in.

## What to collect

Eight folders, named for the eight tags. Aim for **4–8 clips each**, so
30–60 in total. `--check` flags any tag with fewer than four, because a
rate computed over three clips is noise wearing a percentage sign.

Two things people under-collect, both of which matter more than they look:

- **`unclear_or_unrelated` needs real examples** — footage that is not
  sports training at all. Without them, the model is never measured on the
  case where the right answer is "say nothing", which is the exact case
  the threshold exists to protect.
- **`other_training` and `team_drill` overlap in practice.** They are the
  likeliest confusion pair, so they need enough examples for the matrix to
  show it rather than hint at it.

Label what a clip **mostly shows**. If it genuinely is not one activity,
cut it or drop it rather than picking the majority — a wrong label does
not read as a wrong label later, it reads as a model that cannot tell two
things apart.

```bash
uv run python eval/run_fixtures.py --check   # shape only, no model, instant
uv run python eval/run_fixtures.py           # the real thing
```

## Reading the output

**Confusion matrix at argmax** — when the model commits, what does it
commit to. Threshold-independent.

**Threshold sweep** — the actual decision:

```
  thresh   tagged   correct   WRONG-AND-CONFIDENT   silent
   0.35        22        19                     3        18
```

- `WRONG-AND-CONFIDENT` **is the column that matters.** Each one is a
  machine-authored claim about a child's video that is simply false.
- `silent` is a clip left untagged. Disappointing, and free.
- Prefer low coverage over any false confidence. The feature is advisory
  and has no consumer yet; a wrong tag has a cost that "no tag" does not.

Three outcomes, and the script names whichever it hits:

1. **A threshold tags a useful fraction with zero wrong** — set
   `CLIP_TAGGING_CONFIDENCE_THRESHOLD` to it in the app cluster and be
   done.
2. **No threshold avoids wrong tags** — a finding, not a tuning problem.
   The model or prompt set cannot tag these clips safely, and shipping any
   threshold would ship false claims about children's videos.
3. **Nothing is tagged at any threshold** — the model does not recognise
   these clips as any of the eight activities at all. Also a finding about
   the model, not the threshold.

For (2) or (3), the cheap next move is the prompt set: edit
`src/clip_tagger/prompts/`, save it as `floorball-v2` (never edit a
version in place — scores are not comparable across wordings), and re-run.
A model swap is the expensive move and should follow evidence, not
precede it.

## What this does not measure

Anything about safety, abuse, nudity, age or faces. That classifier does
not exist and is refused by design; if one is ever wanted it needs its own
ADR, review, consent disclosure and an evaluation with a different shape
entirely.

## Frames match production exactly

Sampling reads `../frame-sampling-contract.json` — the same file the
backend's sampler reads, with a test on each side asserting against it.

This was not always true. An earlier version used ffmpeg's `thumbnail`
filter, which selects the most *representative* frames rather than
evenly-spaced ones. It was grading the model on a nicer sample than the
app actually sends, every number it printed was quietly optimistic, and
nothing said so. That is the failure an evaluation exists to not have.
