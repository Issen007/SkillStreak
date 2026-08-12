"""Stage 0b: measure the tagger on clips that contain no user of this app.

Answers one question — **what confidence threshold, if any, makes these
tags worth storing?** — and answers it with a table rather than a verdict,
because that is a product decision and not this script's to make.

Two things worth knowing before reading the numbers:

- **It scores in-process by default.** The deployed topology has no HTTP
  endpoint at all: the GPU pod is a pull worker with no Service and
  `ingress: []`. There is nothing to point a `--url` at. Passing one is
  still supported for a locally-run service, but the default needs no
  server.
- **It samples frames exactly as production does**, by reading
  `frame-sampling-contract.json` — the same file the backend's sampler
  reads. An earlier version of this script used ffmpeg's `thumbnail`
  filter, which picks the most representative frames rather than
  evenly-spaced ones; it was grading the model on a nicer sample than the
  app sends, and every number it printed was quietly optimistic.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import tempfile
from collections import defaultdict
from pathlib import Path

FIXTURES = Path(__file__).parent / "fixtures"
CONTRACT = json.loads(
    (Path(__file__).parent.parent / "frame-sampling-contract.json").read_text()
)

TAGS = [
    "shooting",
    "stickhandling",
    "passing",
    "fitness_conditioning",
    "goalkeeping",
    "team_drill",
    "other_training",
    "unclear_or_unrelated",
]

VIDEO_SUFFIXES = {".mp4", ".mov", ".m4v", ".webm", ".mkv", ".avi"}
IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png"}


def ffmpeg_binary() -> str:
    """A usable ffmpeg, or a message a person can act on.

    Prefers `imageio-ffmpeg`'s bundled static build, so `uv sync --extra
    eval` is the whole setup and there is no undocumented `apt-get`
    step — the kind of step that turns a tool into one nobody runs.
    Falls back to a system ffmpeg if one is on PATH.
    """
    try:
        import imageio_ffmpeg
    except ImportError:
        # The `eval` extra is not installed. Fall through to a system
        # ffmpeg, which is a perfectly good answer.
        pass
    else:
        return imageio_ffmpeg.get_ffmpeg_exe()

    from shutil import which

    found = which("ffmpeg")
    if found:
        return found

    raise SystemExit(
        "ffmpeg is required to turn fixture videos into frames, and none "
        "was found.\n\n"
        "  uv sync --extra model --extra eval\n\n"
        "installs a bundled one. (The runtime image deliberately has no "
        "ffmpeg: in production the BACKEND samples frames and posts them, "
        "so the tagger never needs it.)"
    )


def sample_frames(path: Path, count: int) -> list[bytes]:
    """Exactly what the API sends, per the shared contract."""
    if path.suffix.lower() in IMAGE_SUFFIXES:
        return [path.read_bytes()]

    with tempfile.TemporaryDirectory() as tmp:
        subprocess.run(
            [
                ffmpeg_binary(), "-hide_banner", "-loglevel", "error",
                "-i", str(path),
                *CONTRACT["extraArgs"],
                "-vf", CONTRACT["videoFilter"],
                "-frames:v", str(count),
                "-q:v", CONTRACT["jpegQuality"],
                f"{tmp}/frame%02d.jpg",
            ],
            check=True,
        )
        return [p.read_bytes() for p in sorted(Path(tmp).glob("*.jpg"))]


def load_fixtures() -> list[tuple[str, Path]]:
    """(true tag, file) pairs, from `fixtures/<tag>/*`."""
    found: list[tuple[str, Path]] = []
    for tag in TAGS:
        folder = FIXTURES / tag
        if not folder.is_dir():
            continue
        for clip in sorted(folder.iterdir()):
            if clip.name.startswith(".") or clip.name == "PROVENANCE.md":
                continue
            if clip.suffix.lower() in VIDEO_SUFFIXES | IMAGE_SUFFIXES:
                found.append((tag, clip))
    return found


PROVENANCE_TEMPLATE = """# Where these clips came from

`eval/fixtures/` is gitignored and nothing in it is ever committed. This
file is the exception, and it exists to force one question per clip:
**where did this come from, and may we use it?**

The rule this set exists under: **no user of this app appears in it.**
Not a child on any team, not a clip from the beta, not a frame of anyone's
uploaded video. A labelled corpus of children's training footage is a far
more sensitive artifact than any single clip in the app — the app's own
clips live inside closed team bubbles under a parental-consent flow, and a
folder of them on a laptop next to a CSV of labels is outside every
control that makes handling them acceptable. That holds for the person who
runs this repository too.

Acceptable sources, and nothing else:

1. **Footage you recorded yourself, with adults who agreed to this use.**
2. **Footage of yourself.**
3. **Openly-licensed material** whose licence permits this use. Record the
   licence and the URL.

If a clip cannot be described in one sentence that makes its origin
obvious, it does not belong in the set.

## The clips

| file | tag | source | who is in it | licence / consent |
|---|---|---|---|---|
| _example.mp4_ | _shooting_ | _recorded 2026-08-20, club hall_ | _me_ | _n/a, self_ |

## Notes on labelling

You are the label. Nobody else here can judge whether a clip is a
`team_drill` or `other_training`, and a wrong label does not read as a
wrong label later — it reads as a model that cannot tell them apart.

Two conventions worth keeping:

- Label what the clip **mostly shows**. A clip is one activity for its
  length far more often than not; if it genuinely is not, cut it or drop
  it rather than picking the majority.
- `unclear_or_unrelated` needs real examples too — footage that is not
  sports training at all. Without them the model is never measured on the
  case where the right answer is "say nothing", which is the case the
  whole threshold exists to protect.
"""


def init_fixtures() -> int:
    """Create the folder-per-tag layout and the provenance file."""
    created = []
    for tag in TAGS:
        folder = FIXTURES / tag
        if not folder.exists():
            folder.mkdir(parents=True)
            created.append(str(folder.relative_to(FIXTURES.parent)))

    provenance = FIXTURES / "PROVENANCE.md"
    if not provenance.exists():
        provenance.write_text(PROVENANCE_TEMPLATE)
        created.append(str(provenance.relative_to(FIXTURES.parent)))

    if created:
        print("created:")
        for path in created:
            print(f"  {path}")
    else:
        print("already set up; nothing to create.")

    print(
        f"\nDrop clips into {FIXTURES.name}/<tag>/ and record each one in "
        "PROVENANCE.md.\nThen: uv run python eval/run_fixtures.py --check"
    )
    return 0


def check_only(fixtures: list[tuple[str, Path]]) -> int:
    """Validate the set's shape without loading a model.

    Runs in a second, needs no GPU and no weights, and is the thing to run
    while actually collecting clips.
    """
    per_tag: dict[str, int] = defaultdict(int)
    for tag, _ in fixtures:
        per_tag[tag] += 1

    print(f"fixtures found: {len(fixtures)}\n")
    width = max(len(t) for t in TAGS) + 2
    missing = []
    thin = []
    for tag in TAGS:
        n = per_tag.get(tag, 0)
        note = ""
        if n == 0:
            missing.append(tag)
            note = "  <- none"
        elif n < 4:
            thin.append(tag)
            note = "  <- thin"
        print(f"  {tag.ljust(width)} {str(n).rjust(3)}{note}")

    provenance = FIXTURES / "PROVENANCE.md"
    print(f"\nPROVENANCE.md: {'present' if provenance.is_file() else 'MISSING'}")

    if missing:
        print(
            f"\n{len(missing)} tag(s) have no fixtures. Per-tag precision and "
            "recall cannot be computed for those, and the confusion matrix "
            "will have empty rows."
        )
    if thin:
        # Said plainly because a matrix over three clips looks just as
        # authoritative as one over thirty.
        print(
            f"{len(thin)} tag(s) have fewer than 4 clips. A rate computed "
            "over that many is noise wearing a percentage sign."
        )
    if not provenance.is_file():
        print(
            "\nPROVENANCE.md is missing. Write it before running an "
            "evaluation: a folder of sports video with no recorded origin "
            "is exactly what this set must never become. See eval/README.md."
        )
        return 1
    return 0


def score_all(fixtures, frames_per_clip, url, token):
    """Returns (true_tag, {tag: score}) per fixture."""
    if url:
        import uuid

        import httpx

        health = httpx.get(f"{url}/health", timeout=30).json()
        if health.get("modelId") == "stub":
            print(
                "Refusing to run: that service is the stub backend. Its "
                "scores are a hash of the image bytes, so every number "
                "below would be meaningless.",
                file=sys.stderr,
            )
            raise SystemExit(2)
        print(f"model={health['modelId']} prompts={health['promptSetVersion']} "
              f"gpu={health['gpu']}  (over HTTP)\n")

        def score(frames):
            response = httpx.post(
                f"{url}/v1/analyse-frames",
                headers={"Authorization": f"Bearer {token}"},
                data={"meta": json.dumps(
                    {"requestId": str(uuid.uuid4()), "frameCount": len(frames)}
                )},
                files=[
                    (f"frame{i}", (f"frame{i}.jpg", payload, "image/jpeg"))
                    for i, payload in enumerate(frames)
                ],
                timeout=120,
            )
            response.raise_for_status()
            return {r["tag"]: r["score"] for r in response.json()["scores"]}
    else:
        sys.path.insert(0, str(Path(__file__).parent.parent / "src"))
        from clip_tagger.model import build_tagger

        tagger = build_tagger()
        if tagger.model_id == "stub":
            print(
                "Refusing to run: CLIP_TAGGER_BACKEND=stub returns a hash of "
                "the image bytes. A confusion matrix over that is a "
                "plausible-looking table that means nothing.",
                file=sys.stderr,
            )
            raise SystemExit(2)
        print(f"model={tagger.model_id} prompts={tagger.prompt_set.version} "
              f"gpu={tagger.on_gpu}  (in-process)\n")
        score = tagger.score

    results = []
    for index, (tag, clip) in enumerate(fixtures, 1):
        print(f"\r  scoring {index}/{len(fixtures)}…", end="", file=sys.stderr)
        results.append((tag, score(sample_frames(clip, frames_per_clip))))
    print("\r" + " " * 40 + "\r", end="", file=sys.stderr)
    return results


def report(results, thresholds):
    present = sorted({t for t, _ in results}, key=TAGS.index)

    # Confusion matrix at argmax, threshold-independent: "when it commits,
    # what does it commit to".
    matrix: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    for actual, scores in results:
        matrix[actual][max(scores, key=scores.get)] += 1

    width = max(len(t) for t in TAGS) + 2
    print("confusion at argmax (rows = truth, cols = prediction)\n")
    print("".ljust(width), " ".join(t[:7].rjust(8) for t in present))
    for actual in present:
        print(actual.ljust(width),
              " ".join(str(matrix[actual].get(p, 0)).rjust(8) for p in present))

    # The actual product question. `unclear_or_unrelated` is excluded from
    # "wrong" because the app never stores it as a tag — predicting it is a
    # decision not to tag, which is a miss, not a false claim.
    print("\n\nthreshold sweep\n")
    print("  thresh   tagged   correct   WRONG-AND-CONFIDENT   silent")
    print("  " + "-" * 62)
    for threshold in thresholds:
        tagged = correct = wrong = silent = 0
        for actual, scores in results:
            top = max(scores, key=scores.get)
            if scores[top] < threshold or top == "unclear_or_unrelated":
                silent += 1
                continue
            tagged += 1
            if top == actual:
                correct += 1
            else:
                wrong += 1
        print(f"  {threshold:>5.2f}   {tagged:>6}   {correct:>7}   "
              f"{wrong:>19}   {silent:>6}"
              + ("   <- none wrong" if tagged and not wrong else ""))

    print(
        "\n  WRONG-AND-CONFIDENT is the column that matters. Each one is a\n"
        "  machine-authored claim about a child's video that is simply\n"
        "  false. `silent` is a clip left untagged — disappointing, and\n"
        "  free. Pick the lowest threshold whose wrong column is 0, then\n"
        "  read `tagged` to see what that costs in coverage."
    )

    # The headline. Guarded, because "zero wrong" is trivially true when
    # nothing was tagged — and a run that tags nothing is not a run with a
    # safe threshold, it is a run with no signal. Reporting 0.20 as "clean"
    # in that case would be the single most misleading line this script
    # could print, so it is the one case handled explicitly.
    def outcome(threshold):
        tagged = wrong = 0
        for actual, scores in results:
            top = max(scores, key=scores.get)
            if scores[top] < threshold or top == "unclear_or_unrelated":
                continue
            tagged += 1
            wrong += top != actual
        return tagged, wrong

    usable = [t for t in thresholds if outcome(t)[0] > 0 and outcome(t)[1] == 0]

    print()
    if usable:
        best = min(usable)
        tagged, _ = outcome(best)
        print(f"  lowest threshold that tags anything with zero wrong: {best:.2f}"
              f"  ({tagged}/{len(results)} clips tagged)")
    elif all(outcome(t)[0] == 0 for t in thresholds):
        print(
            "  Nothing was tagged at ANY threshold — every clip's top score\n"
            "  was `unclear_or_unrelated`, or below 0.20.\n\n"
            "  This is not a threshold you can set. It means the model does\n"
            "  not recognise these clips as any of the eight activities. If\n"
            "  the fixtures really are floorball training, that is a finding\n"
            "  about the model or the prompt set, not about the threshold."
        )
    else:
        print(
            "  NO threshold tags anything without also producing a\n"
            "  wrong-and-confident tag. That is a finding, not a tuning\n"
            "  problem: this model and prompt set cannot currently tag these\n"
            "  clips safely, and shipping any threshold would mean shipping\n"
            "  false claims about children's videos."
        )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--frames", type=int,
                        default=CONTRACT["defaultFrameCount"])
    parser.add_argument("--url", default="",
                        help="Score over HTTP instead of in-process. The "
                             "deployed worker exposes no endpoint, so this "
                             "is only for a locally-run service.")
    parser.add_argument("--token", default="")
    parser.add_argument("--check", action="store_true",
                        help="Validate the fixture set and exit. No model.")
    parser.add_argument("--init", action="store_true",
                        help="Create the folder-per-tag layout and "
                             "PROVENANCE.md, then exit.")
    args = parser.parse_args()

    if args.init:
        return init_fixtures()

    fixtures = load_fixtures()
    if not fixtures:
        print(f"No fixtures under {FIXTURES}. Run with --init, then see "
              "eval/README.md.")
        return 1
    if args.check:
        return check_only(fixtures)

    status = check_only(fixtures)
    if status != 0:
        return status
    print()

    results = score_all(fixtures, args.frames, args.url.rstrip("/"), args.token)
    report(results, [0.20, 0.25, 0.30, 0.35, 0.40, 0.45, 0.50, 0.60, 0.70])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
