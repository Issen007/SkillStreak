"""The prompt set is versioned data, and the drift guards around it."""

from __future__ import annotations

import pytest

from clip_tagger.model import TAG_VALUES, load_prompt_set


def test_ships_a_prompt_for_every_tag_in_the_vocabulary():
    # A tag in Postgres with no prompt here would silently never be
    # predicted — a quiet failure, so it is a startup error instead.
    prompt_set = load_prompt_set("floorball-v1")
    assert set(prompt_set.prompts) == set(TAG_VALUES)
    assert all(prompt_set.prompts[tag] for tag in TAG_VALUES)


def test_the_vocabulary_matches_the_shipped_postgres_enum():
    # These eight are `video_clip_tag.value` (VideoClipTagValue). If the
    # backend enum changes, this fails here rather than by the API silently
    # dropping every response.
    assert TAG_VALUES == (
        "shooting",
        "stickhandling",
        "passing",
        "fitness_conditioning",
        "goalkeeping",
        "team_drill",
        "other_training",
        "unclear_or_unrelated",
    )


def test_flat_ordering_pairs_each_sentence_with_its_tag():
    prompt_set = load_prompt_set("floorball-v1")
    sentences, owners = prompt_set.flat
    assert len(sentences) == len(owners)
    for tag in TAG_VALUES:
        mine = [s for s, o in zip(sentences, owners) if o == tag]
        assert mine == prompt_set.prompts[tag]


def test_refuses_a_path_shaped_prompt_set_name():
    # The name indexes a file shipped in the image. A caller-shaped path
    # here would be a file-read primitive on a service holding derived
    # frames of children.
    with pytest.raises(ValueError):
        load_prompt_set("../../../etc/passwd")


def test_refuses_an_unknown_prompt_set():
    with pytest.raises(FileNotFoundError):
        load_prompt_set("floorball-v99")
