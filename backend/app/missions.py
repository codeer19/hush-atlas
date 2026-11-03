"""Static Soundwalk mission definitions.

Missions describe an activity, not a score. The suggested stop count is guidance;
completion is always derived from the participant's saved recordings.
"""

from __future__ import annotations

from typing import Any


MISSIONS: list[dict[str, Any]] = [
    {
        "key": "five-sounds",
        "title": "Five Sounds",
        "short_description": (
            "Take a short walk and listen closely at a few ordinary places. "
            "Notice how many different sounds share the same patch of world."
        ),
        "purpose": (
            "A listening exercise. The name is an invitation, not a target."
        ),
        "estimated_duration_minutes": 10,
        "duration_is_estimate": True,
        "suggested_stops": 4,
        "minimum_stops": 2,
        "maximum_stops": 8,
        "what_you_will_do": [
            "Choose a safe outdoor place you can walk around.",
            "At each stop, pause and listen before recording.",
            "Record a short sound and add a note about what you noticed.",
            "See what the sound reader finds.",
            "Finish with a map of the sounds along your route.",
        ],
        "comparison_mode": "within-session",
        "default_stop_names": [
            "First listening point",
            "Second listening point",
            "Third listening point",
            "Fourth listening point",
            "Fifth listening point",
            "Sixth listening point",
            "Seventh listening point",
            "Eighth listening point",
        ],
    },
    {
        "key": "two-moments",
        "title": "One Place, Two Moments",
        "short_description": (
            "Map one familiar place today, then come back another day and walk the "
            "same route. Compare the recordings and see what changed."
        ),
        "purpose": (
            "A repeatable walk. The clearest comparison comes from keeping the route, "
            "time of day, recording length, and equipment as similar as you can."
        ),
        "estimated_duration_minutes": 12,
        "duration_is_estimate": True,
        "suggested_stops": 3,
        "minimum_stops": 2,
        "maximum_stops": 8,
        "what_you_will_do": [
            "Create a short route with named stops.",
            "Record each stop. Your audio and results stay together.",
            "Save the route so you can walk it again.",
            "Come back later, repeat the route, and record new sounds.",
            "Compare the two visits and open the recordings behind each result.",
        ],
        "comparison_mode": "repeat-visit",
        "default_stop_names": [
            "First listening point",
            "Second listening point",
            "Third listening point",
            "Fourth listening point",
            "Fifth listening point",
            "Sixth listening point",
            "Seventh listening point",
            "Eighth listening point",
        ],
    },
    {
        "key": "find-the-quiet",
        "title": "Find the Quiet",
        "short_description": (
            "Visit a few safe places and compare the sounds found at each. Listen for "
            "where the pattern feels different, then open the recordings."
        ),
        "purpose": (
            "A listening walk that compares the sounds found at each stop. It does not "
            "measure loudness, and no stop is declared quiet or loud."
        ),
        "estimated_duration_minutes": 15,
        "duration_is_estimate": True,
        "suggested_stops": 4,
        "minimum_stops": 2,
        "maximum_stops": 8,
        "what_you_will_do": [
            "Choose a few easy-to-reach stops in one area.",
            "Pause, listen, and record at every stop.",
            "Find the sounds in each recording.",
            "Compare what was found between stops.",
            "Listen to the original recordings before drawing a conclusion.",
        ],
        "comparison_mode": "between-stops",
        "default_stop_names": [
            "First listening point",
            "Second listening point",
            "Third listening point",
            "Fourth listening point",
            "Fifth listening point",
            "Sixth listening point",
            "Seventh listening point",
            "Eighth listening point",
        ],
    },
]

MISSION_BY_KEY = {item["key"]: item for item in MISSIONS}


def mission_for(key: str) -> dict[str, Any] | None:
    return MISSION_BY_KEY.get(key)


def mission_key_or_error(key: str) -> dict[str, Any]:
    mission = mission_for(key)
    if mission is None:
        raise ValueError(f"Unknown Soundwalk mission: {key}")
    return mission
