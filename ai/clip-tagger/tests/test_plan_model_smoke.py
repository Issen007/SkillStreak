"""Actually construct PlanModel and generate. Opt-in, never in CI.

Twice now a model wrapper has been merged without ever being executed —
SiglipTagger, then PlanModel — and both times the failure was in the
transformers call rather than in anything a mock could stand in for.
PlanModel crash-looped the pod on `device_map` requiring `accelerate`, a
package nothing had asked for.

CI cannot run this: it downloads weights. So it is opt-in and cheap to
run, with a small model of the same family that exercises the identical
API:

    CLIP_TAGGER_SMOKE_MODEL=Qwen/Qwen2.5-0.5B-Instruct \\
      uv run pytest tests/test_plan_model_smoke.py -s

Run it before shipping a change to PlanModel. It proves the code path,
not the output quality — the 3B's writing is a separate question and was
never what broke.
"""

from __future__ import annotations

import os

import pytest

MODEL = os.environ.get("CLIP_TAGGER_SMOKE_MODEL", "")

pytestmark = pytest.mark.skipif(
    not MODEL,
    reason="set CLIP_TAGGER_SMOKE_MODEL to run (downloads weights)",
)


def test_loads_and_generates():
    from clip_tagger.plan_generator import PlanModel, build_prompt

    model = PlanModel(MODEL, max_new_tokens=120)
    assert model.model_id == MODEL

    job = {
        "leaseId": "l1",
        "promptText": "kul pass med mycket rörelse",
        "ageBand": "9-11",
        "durationMinutes": 30,
        "focus": "passning",
        "locale": "sv",
        "corpusVersion": "1:x",
        "drills": [
            {
                "slug": "kortpassningar-under-press",
                "title": "Kortpassningar under press",
                "ageBand": "9-11",
                "focus": "passning",
                "durationMinutes": 15,
                "body": "Tva spelare, fem meter isar.",
            }
        ],
    }

    output = model.generate(*build_prompt(job))

    # Deliberately weak assertions. A small model's prose is not worth
    # asserting on; that it produced non-empty text through the real
    # tokenizer, chat template and generate() call is the whole point.
    assert output.strip()
    assert len(output) < 20_001
