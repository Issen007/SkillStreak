"""The SigLIP calibration, which is easy to omit and invisible when omitted.

Skipped unless torch is installed. CI deliberately installs the service
WITHOUT `--extra model` (torch is ~2.5 GB and adds minutes to every PR),
so these run locally and on any machine that has synced the model extra —
stated here rather than left as a silent coverage gap.

The bug this pins: cosine similarities between a real image and eight
plausible sentences all sit within a whisker of each other, so a softmax
over the raw values returns ~0.125 for every tag regardless of the
picture. The service still answers, the shape is still valid, and the
app's confidence threshold quietly becomes meaningless. SigLIP ships a
learned `logit_scale`/`logit_bias` precisely for this.
"""

from __future__ import annotations

import pytest

torch = pytest.importorskip("torch")

from clip_tagger.model import TAG_VALUES, SiglipTagger, load_prompt_set


class FakeSiglip:
    """Just enough model to exercise the scoring path without weights.

    Returns embeddings whose cosine similarities are realistically close
    together — which is the condition that makes the calibration matter.
    """

    def __init__(self, scale: float | None, bias: float | None):
        self.logit_scale = (
            torch.tensor(scale) if scale is not None else None
        )
        self.logit_bias = torch.tensor(bias) if bias is not None else None

    def to(self, _device):
        return self

    def eval(self):
        return self

    def get_text_features(self, **_kwargs):
        # 8 tags x 2 sentences, nearly-parallel unit vectors.
        rows = []
        for index in range(len(TAG_VALUES) * 2):
            vector = torch.ones(16)
            vector[index % 16] += 0.05 * (index + 1)
            rows.append(vector / vector.norm())
        return torch.stack(rows)

    def get_image_features(self, **_kwargs):
        vector = torch.ones(16)
        vector[3] += 0.5
        return (vector / vector.norm()).unsqueeze(0)


def build(monkeypatch, *, scale, bias) -> SiglipTagger:
    prompt_set = load_prompt_set("floorball-v1")
    tagger = SiglipTagger.__new__(SiglipTagger)
    tagger.model_id = "fake"
    tagger.prompt_set = prompt_set
    tagger._torch = torch
    tagger.on_gpu = False
    tagger._device = "cpu"
    tagger._model = FakeSiglip(scale, bias)
    tagger._processor = lambda **kwargs: _Batch()
    _, owners = prompt_set.flat
    tagger._owners = owners
    tagger._logit_scale = tagger._model.logit_scale
    tagger._logit_bias = tagger._model.logit_bias

    with torch.no_grad():
        features = tagger._model.get_text_features()
        tagger._text = features / features.norm(dim=-1, keepdim=True)
    return tagger


class _Batch(dict):
    def to(self, _device):
        return self


def _real_jpeg() -> bytes:
    """A genuinely decodable JPEG: score() opens it, so magic bytes alone
    are not enough here (unlike the service tests, which never reach the
    decoder because they stop at validation)."""
    import io

    from PIL import Image

    buffer = io.BytesIO()
    Image.new("RGB", (32, 32), (10, 120, 60)).save(buffer, "JPEG")
    return buffer.getvalue()


JPEG = _real_jpeg()


def test_uncalibrated_scores_are_nearly_uniform(monkeypatch):
    # The bug, demonstrated: without the learned scale every tag lands
    # within a couple of percent of 1/8 and no threshold can discriminate.
    tagger = build(monkeypatch, scale=None, bias=None)
    scores = tagger.score([JPEG])
    spread = max(scores.values()) - min(scores.values())
    assert spread < 0.05, "this is the failure mode being guarded against"


def test_the_learned_scale_spreads_the_distribution(monkeypatch):
    # The property is the widening itself, not any particular number — the
    # absolute spread depends on the embeddings, and asserting a constant
    # here would pin the fixture rather than the behaviour. On the real
    # model this was the difference between 0.014 and 0.998.
    flat = build(monkeypatch, scale=None, bias=None).score([JPEG])
    calibrated = build(monkeypatch, scale=4.0, bias=-10.0).score([JPEG])

    def spread(scores):
        return max(scores.values()) - min(scores.values())

    assert spread(calibrated) > spread(flat) * 2


def test_scores_are_a_distribution_over_every_tag(monkeypatch):
    tagger = build(monkeypatch, scale=4.0, bias=-10.0)
    scores = tagger.score([JPEG])
    assert set(scores) == set(TAG_VALUES)
    assert sum(scores.values()) == pytest.approx(1.0)


def test_a_missing_logit_scale_is_tolerated_not_fatal(monkeypatch):
    # Another image-text model may not ship one. Degrading to an
    # uncalibrated distribution is bad; crashing at load is worse, and the
    # eval harness is where a flat distribution should be caught.
    tagger = build(monkeypatch, scale=None, bias=None)
    assert sum(tagger.score([JPEG]).values()) == pytest.approx(1.0)
