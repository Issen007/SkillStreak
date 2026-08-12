"""Stage 0b harness: score a fixture set and print a confusion matrix.

Reads `eval/fixtures/<tag>/*.mp4|*.jpg`, samples frames the same way the
API will (evenly spaced, per Decision 4), posts them to a running tagger,
and reports the numbers Decision 6 asks for.

Run against a real GPU pod, not the stub — the stub's scores are a hash
and a confusion matrix over them means nothing. The harness refuses to
report if it is talking to a stub, rather than producing a plausible table
nobody can tell is fake.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import tempfile
import uuid
from collections import defaultdict
from pathlib import Path

import httpx

FIXTURES = Path(__file__).parent / "fixtures"
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


def sample_frames(path: Path, count: int) -> list[bytes]:
    """Evenly-spaced JPEG stills, matching what the API will send.

    Same ffmpeg invocation shape as the API's sampler, so the harness
    measures the model on the input the model will actually receive rather
    than on nicer frames.
    """
    if path.suffix.lower() in {".jpg", ".jpeg", ".png"}:
        return [path.read_bytes()]

    with tempfile.TemporaryDirectory() as tmp:
        subprocess.run(
            [
                "ffmpeg", "-hide_banner", "-loglevel", "error",
                "-i", str(path),
                "-vf", "thumbnail,fps=1/1,scale=224:224:force_original_aspect_ratio=increase,crop=224:224",
                "-frames:v", str(count),
                "-q:v", "3",
                f"{tmp}/frame%02d.jpg",
            ],
            check=True,
        )
        return [p.read_bytes() for p in sorted(Path(tmp).glob("*.jpg"))]


def analyse(url: str, token: str, frames: list[bytes]) -> dict[str, float]:
    files = [
        (f"frame{i}", (f"frame{i}.jpg", payload, "image/jpeg"))
        for i, payload in enumerate(frames)
    ]
    response = httpx.post(
        f"{url}/v1/analyse-frames",
        headers={"Authorization": f"Bearer {token}"},
        data={"meta": json.dumps({"requestId": str(uuid.uuid4()),
                                  "frameCount": len(frames)})},
        files=files,
        timeout=120,
    )
    response.raise_for_status()
    return {row["tag"]: row["score"] for row in response.json()["scores"]}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://localhost:8000")
    parser.add_argument("--token", default="")
    parser.add_argument("--frames", type=int, default=8)
    parser.add_argument("--threshold", type=float, default=0.35)
    args = parser.parse_args()

    health = httpx.get(f"{args.url}/health", timeout=30).json()
    if health.get("modelId") == "stub":
        # A confusion matrix over hashed bytes is a plausible-looking table
        # that means nothing. Refusing is better than printing it.
        print(
            "Refusing to run: that service is the stub backend. Its scores "
            "are a hash of the image bytes, so every number below would be "
            "meaningless. Point --url at a real GPU pod.",
            file=sys.stderr,
        )
        return 2

    print(f"model={health['modelId']} prompts={health['promptSetVersion']} "
          f"gpu={health['gpu']}\n")

    matrix: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    false_confident = 0
    covered = 0
    total = 0

    for tag in TAGS:
        folder = FIXTURES / tag
        if not folder.is_dir():
            continue
        for clip in sorted(folder.iterdir()):
            if clip.name.startswith("."):
                continue
            scores = analyse(args.url, args.token, sample_frames(clip, args.frames))
            predicted = max(scores, key=scores.get)
            confident = scores[predicted] >= args.threshold

            total += 1
            matrix[tag][predicted] += 1
            if confident:
                covered += 1
                if predicted != tag:
                    false_confident += 1

    if not total:
        print(f"No fixtures found under {FIXTURES}. See eval/README.md.")
        return 1

    width = max(len(t) for t in TAGS) + 2
    print("actual \\ predicted".ljust(width), " ".join(t[:6].rjust(7) for t in TAGS))
    for actual in TAGS:
        row = matrix.get(actual)
        if not row:
            continue
        print(actual.ljust(width),
              " ".join(str(row.get(p, 0)).rjust(7) for p in TAGS))

    print(f"\nclips                {total}")
    # The number that matters most: a wrong tag above the threshold is a
    # machine-authored claim about a child's video.
    print(f"false-confident      {false_confident} "
          f"({false_confident / total:.1%})   <- minimise this first")
    print(f"coverage             {covered} ({covered / total:.1%})")
    print(f"threshold            {args.threshold}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
