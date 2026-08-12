"""Zero-shot training-type scoring over sampled frames.

Decision 6 fixes the *shape* — a zero-shot image-text model scored against
a versioned prompt set — and leaves the specific model, quantization and
frame count to be measured on the real hardware in Stage 0b. This module
is written to that split: the backend is swappable, the contract is not.

Two backends exist:

- ``siglip``  — the real one. Loads weights once at import and scores
  frames on the GPU.
- ``stub``    — deterministic scores derived from the image bytes, so the
  service, its auth, its limits and its contract can be exercised on a
  laptop and in CI without 2.5 GB of torch wheels.

The stub is **not** a fallback. If the real backend fails to load, the
service fails to start rather than quietly serving fake scores about
children's training — the failure mode that would otherwise be invisible
is a pod that looks healthy and returns confident nonsense. Selecting the
stub takes an explicit ``CLIP_TAGGER_BACKEND=stub``, and ``/health`` then
reports ``modelId: "stub"``, so a running pod can never misrepresent what
it is. That is the same "ask the pod what it actually is" property
CLAUDE.md credits with catching the 2026-07-30 wrong-image incident.
"""

from __future__ import annotations

import hashlib
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

import yaml

PROMPTS_DIR = Path(__file__).parent / "prompts"

# The eight values already in Postgres as `video_clip_tag.value`
# (VideoClipTagValue). Duplicated here rather than imported across a
# language boundary, and asserted against the prompt file at load so the
# two cannot drift silently. The API validates again on receipt and drops
# anything it does not recognise — this copy is a guard, not the
# enforcement point (Decision 5).
TAG_VALUES: tuple[str, ...] = (
    "shooting",
    "stickhandling",
    "passing",
    "fitness_conditioning",
    "goalkeeping",
    "team_drill",
    "other_training",
    "unclear_or_unrelated",
)


@dataclass(frozen=True)
class PromptSet:
    version: str
    # tag -> the sentences scored for it. Several per tag; a frame's score
    # for a tag is the best-matching sentence, so one awkward wording does
    # not sink a whole category.
    prompts: dict[str, list[str]]

    @property
    def flat(self) -> tuple[list[str], list[str]]:
        """(sentences, owning tag per sentence) — the order the encoder sees."""
        sentences: list[str] = []
        owners: list[str] = []
        for tag in TAG_VALUES:
            for sentence in self.prompts[tag]:
                sentences.append(sentence)
                owners.append(tag)
        return sentences, owners


def load_prompt_set(name: str = "floorball-v1") -> PromptSet:
    # No path joining from caller input: the name indexes a file shipped in
    # the image, and a caller-shaped path here would be a file-read
    # primitive on a service that holds derived frames of children.
    if not name.replace("-", "").replace("_", "").replace(".", "").isalnum():
        raise ValueError(f"Not a prompt set name: {name!r}")

    path = PROMPTS_DIR / f"{name}.yaml"
    if not path.is_file():
        raise FileNotFoundError(f"No prompt set {name!r} at {path}")

    raw = yaml.safe_load(path.read_text(encoding="utf-8"))
    prompts = {tag: list(sentences) for tag, sentences in raw["prompts"].items()}

    # Drift guard. A tag added to Postgres but not here would silently
    # never be predicted; one here but not in Postgres would be dropped by
    # the API on every response. Both are quiet failures, so they are
    # startup errors instead.
    missing = set(TAG_VALUES) - set(prompts)
    extra = set(prompts) - set(TAG_VALUES)
    if missing or extra:
        raise ValueError(
            f"Prompt set {name!r} does not match the tag vocabulary "
            f"(missing={sorted(missing)}, unexpected={sorted(extra)})"
        )
    if any(not sentences for sentences in prompts.values()):
        raise ValueError(f"Prompt set {name!r} has a tag with no prompts")

    return PromptSet(version=raw["version"], prompts=prompts)


class Tagger(Protocol):
    model_id: str
    prompt_set: PromptSet
    on_gpu: bool

    def score(self, frames: list[bytes]) -> dict[str, float]:
        """Frames -> one score per tag, every tag present. Never persists."""
        ...


class StubTagger:
    """Deterministic, explicitly-selected, and honest about being fake.

    Scores are a hash of the frame bytes, so the same input gives the same
    output and a test can assert on real numbers — but nothing here looks
    at the picture. ``model_id`` is ``"stub"`` everywhere it is reported.
    """

    model_id = "stub"

    def __init__(self, prompt_set: PromptSet) -> None:
        self.prompt_set = prompt_set
        self.on_gpu = False

    def score(self, frames: list[bytes]) -> dict[str, float]:
        digest = hashlib.sha256(b"".join(frames)).digest()
        raw = {
            tag: digest[index % len(digest)] + 1
            for index, tag in enumerate(TAG_VALUES)
        }
        total = sum(raw.values())
        return {tag: value / total for tag, value in raw.items()}


class SiglipTagger:
    """The real backend: one image-text encoder, scored against the prompts.

    Weights load once at construction. The service constructs this before
    binding its port, so a pod that cannot load its model never becomes
    Ready rather than failing on the first real clip.
    """

    def __init__(self, model_id: str, prompt_set: PromptSet) -> None:
        # Imported here, not at module scope, so the stub path does not
        # need torch installed at all.
        import torch
        from transformers import AutoModel, AutoProcessor

        self.model_id = model_id
        self.prompt_set = prompt_set
        self._torch = torch

        self.on_gpu = torch.cuda.is_available()
        self._device = "cuda" if self.on_gpu else "cpu"

        self._processor = AutoProcessor.from_pretrained(model_id)
        self._model = AutoModel.from_pretrained(model_id).to(self._device).eval()

        # Prompts are fixed for the process lifetime, so their embeddings
        # are computed once rather than per request. On an A2 this is the
        # difference between text encoding dominating the request and not
        # appearing in it.
        sentences, self._owners = prompt_set.flat
        with torch.no_grad():
            inputs = self._processor(
                text=sentences, padding="max_length", return_tensors="pt"
            ).to(self._device)
            features = self._model.get_text_features(**inputs)
            self._text = features / features.norm(dim=-1, keepdim=True)

    def score(self, frames: list[bytes]) -> dict[str, float]:
        import io

        from PIL import Image

        torch = self._torch
        images = [
            Image.open(io.BytesIO(frame)).convert("RGB") for frame in frames
        ]

        with torch.no_grad():
            inputs = self._processor(images=images, return_tensors="pt").to(
                self._device
            )
            features = self._model.get_image_features(**inputs)
            image_features = features / features.norm(dim=-1, keepdim=True)

            # (frames x sentences) similarity.
            similarity = image_features @ self._text.T

            # Sentence -> tag: best-matching sentence wins, so one awkward
            # wording does not sink a category it shares with a good one.
            per_tag = []
            for tag in TAG_VALUES:
                columns = [
                    index
                    for index, owner in enumerate(self._owners)
                    if owner == tag
                ]
                per_tag.append(similarity[:, columns].max(dim=1).values)
            stacked = torch.stack(per_tag, dim=1)

            # Frames -> clip: mean across frames. A clip is one activity for
            # its whole length far more often than not, and max() would let
            # a single ambiguous frame decide the whole tag.
            clip_scores = stacked.mean(dim=0)

            # Softmax so the eight scores are comparable and sum to 1 — the
            # app thresholds on them, and a raw cosine similarity is not a
            # number a product knob can be set against.
            probabilities = torch.softmax(clip_scores, dim=0)

        return {
            tag: float(probabilities[index])
            for index, tag in enumerate(TAG_VALUES)
        }


def build_tagger() -> Tagger:
    """Construct the backend named by the environment.

    Unknown values are an error rather than a default, so a typo in a
    ConfigMap cannot silently downgrade a GPU pod to fake scores.
    """
    backend = os.environ.get("CLIP_TAGGER_BACKEND", "siglip").strip().lower()
    prompt_set = load_prompt_set(
        os.environ.get("CLIP_TAGGER_PROMPT_SET", "floorball-v1")
    )

    if backend == "stub":
        return StubTagger(prompt_set)
    if backend == "siglip":
        model_id = os.environ.get(
            "CLIP_TAGGER_MODEL_ID", "google/siglip-base-patch16-224"
        )
        return SiglipTagger(model_id, prompt_set)

    raise ValueError(
        f"Unknown CLIP_TAGGER_BACKEND {backend!r} (expected 'siglip' or 'stub')"
    )
