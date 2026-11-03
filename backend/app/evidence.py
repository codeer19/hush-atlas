"""Soundscape fingerprint and evidence export helpers."""

from __future__ import annotations

import json
from typing import Any

from .analysis import analysis_payload
from .comparison import ComparisonNotFoundError, get_comparison
from .config import Settings
from .db import connect
from .repository import get_recording


def _stop_context(connection, recording_id: int) -> dict[str, Any] | None:
    row = connection.execute(
        """
        SELECT s.id AS stop_id, s.name AS stop_name, s.stop_order, s.observation,
               w.id AS session_id, w.title AS session_title, w.status AS session_status,
               r.id AS route_id, r.name AS route_name
          FROM walk_stops s
          JOIN walk_sessions w ON w.id = s.session_id
          LEFT JOIN routes r ON r.id = w.route_id
         WHERE s.recording_id = ?
         ORDER BY w.id DESC LIMIT 1
        """,
        (recording_id,),
    ).fetchone()
    if not row:
        return None
    return {
        "stop_id": row["stop_id"],
        "stop_name": row["stop_name"],
        "stop_order": row["stop_order"],
        "observation": row["observation"],
        "session_id": row["session_id"],
        "session_title": row["session_title"],
        "session_status": row["session_status"],
        "route_id": row["route_id"],
        "route_name": row["route_name"],
    }


def fingerprint_payload(settings: Settings, recording_id: int) -> dict[str, Any] | None:
    recording = get_recording(settings, recording_id)
    if recording is None:
        return None
    analysis = analysis_payload(settings, recording_id)
    with connect(settings) as connection:
        context = _stop_context(connection, recording_id)
        run = analysis.get("analysis")
        config: dict[str, Any] = {}
        if run:
            run_row = connection.execute(
                "SELECT config_json, window_seconds FROM analysis_runs WHERE id = ?",
                (run["id"],),
            ).fetchone()
            if run_row:
                try:
                    config = json.loads(run_row["config_json"] or "{}")
                except json.JSONDecodeError:
                    config = {}
                run["window_seconds"] = run_row["window_seconds"]
        classes = (run or {}).get("classes", [])
        event_count = sum(len(item.get("events", [])) for item in classes)
        peak = max((item.get("peak_score", 0.0) for item in classes), default=0.0)
    warnings = [
        "The waveform and times come from your saved audio and the saved sound results.",
        "Sound matches are rough labels from the sound reader, not proven identities. A broad "
        "name like “Bird” does not name a species, speaker, or exact source.",
    ]
    if recording["analysis_status"] == "failed":
        warnings.insert(
            0,
            "The sound reader could not finish this recording. Your audio is safe. Try again "
            "from the recording page to create these details.",
        )
    elif recording["analysis_status"] in {"not_analyzed", "queued", "running"}:
        warnings.insert(
            0,
            "These details will appear after the sound reader finishes. No sounds are shown "
            "before it runs.",
        )
    elif not classes:
        warnings.insert(
            0,
            "The sound reader finished but found no sounds at the chosen match level. That is "
            "not the same as a silent recording.",
        )
    return {
        "recording": recording,
        "stop_context": context,
        "analysis": analysis,
        "fingerprint": {
            "recording_id": recording_id,
            "title": recording["title"],
            "place_name": recording["place_name"],
            "stop_name": context["stop_name"] if context else None,
            "recorded_at": recording["recorded_at"],
            "duration_seconds": recording["duration_seconds"],
            "model_name": (run or {}).get("model_name"),
            "model_version": (run or {}).get("model_version"),
            "window_count": (run or {}).get("window_count", 0),
            "threshold": (run or {}).get("threshold"),
            "event_count": event_count,
            "class_count": len(classes),
            "peak_score": peak,
            "config": config,
            "audio_url": recording["audio_url"],
            "waveform_peaks": recording["waveform"]["peaks"],
        },
        "warnings": warnings,
    }


def _recording_evidence(
    settings: Settings, recording_id: int, class_index: int
) -> dict[str, Any] | None:
    recording = get_recording(settings, recording_id)
    if recording is None:
        return None
    class_events: list[dict[str, Any]] = []
    with connect(settings) as connection:
        context = _stop_context(connection, recording_id)
        run = connection.execute(
            """
            SELECT id FROM analysis_runs
             WHERE recording_id = ? AND status = 'completed'
             ORDER BY id DESC LIMIT 1
            """,
            (recording_id,),
        ).fetchone()
        if run:
            class_events = [
                {
                    "start_seconds": row["start_seconds"],
                    "end_seconds": row["end_seconds"],
                    "model_score": row["model_score"],
                }
                for row in connection.execute(
                    """
                    SELECT start_seconds, end_seconds, model_score
                      FROM event_detections
                     WHERE analysis_run_id = ? AND class_index = ?
                     ORDER BY start_seconds
                    """,
                    (run["id"], class_index),
                ).fetchall()
            ]
    return {
        "recording": {
            "id": recording["id"],
            "title": recording["title"],
            "recorded_at": recording["recorded_at"],
            "duration_seconds": recording["duration_seconds"],
            "analysis_status": recording["analysis_status"],
            "audio_url": recording["audio_url"],
            "waveform_peaks": recording["waveform"]["peaks"],
            "top_classes": recording["top_classes"],
            "class_events": class_events,
        },
        "stop_context": context,
    }


def comparison_evidence(
    settings: Settings, comparison_id: int, class_index: int
) -> dict[str, Any]:
    comparison = get_comparison(settings, comparison_id)
    result = next(
        (item for item in comparison["results"] if item["class_index"] == class_index),
        None,
    )
    if result is None:
        raise KeyError(class_index)
    baseline = [
        _recording_evidence(settings, item["recording_id"], class_index)
        for item in result["baseline_recording_rates"]
    ]
    recent = [
        _recording_evidence(settings, item["recording_id"], class_index)
        for item in result["recent_recording_rates"]
    ]
    return {
        "comparison": comparison,
        "result": result,
        "baseline_recordings": [item for item in baseline if item],
        "recent_recordings": [item for item in recent if item],
        "evidence_notes": [
            "A sound counts as found in a moment when its match is at or above "
            f"{comparison['threshold']:.2f}. The group rate is the average of each recording's "
            "rate.",
            "A missing sound only means it was not found in these moments. It is not proof that "
            "the sound is absent from the place.",
            "Playback is the original saved audio. The strongest moments come from the saved "
            "results, not a generated clip.",
        ],
    }


def comparison_report(
    settings: Settings, comparison_id: int, class_index: int | None = None
) -> str:
    comparison = get_comparison(settings, comparison_id)
    lines = [
        f"# Hush Atlas comparison #{comparison['id']}",
        "",
        f"**Place:** {comparison['place_name']}  ",
        f"**Created:** {comparison['created_at']}  ",
        f"**Sound reader:** {comparison['model_name']}"
        + (f" · {comparison['model_version']}" if comparison["model_version"] else "")
        + "  ",
        f"**Match level:** {comparison['threshold']:.2f}  ",
        f"**Change size:** {comparison['change_threshold_pp']:.1f} points  ",
        f"**Reliability:** {'Good' if comparison['reliability'] == 'adequate' else 'Limited'}  ",
        f"**Snapshot:** {comparison['input_hash']}",
        "",
        "## Selected recordings",
        "",
        "Earlier:",
    ]
    for item in comparison["baseline"]["recordings"]:
        lines.append(
            f"- {item['title']} — {item['recorded_at']} — {item['duration_seconds']:.1f} s"
        )
    lines.append("")
    lines.append("Recent:")
    for item in comparison["recent"]["recordings"]:
        lines.append(
            f"- {item['title']} — {item['recorded_at']} — {item['duration_seconds']:.1f} s"
        )
    lines.append("")
    results = comparison["results"]
    if class_index is not None:
        results = [item for item in results if item["class_index"] == class_index]
        if not results:
            raise KeyError(class_index)
    lines.extend(["## Sounds", ""])
    classification_labels = {
        "fading": "fading",
        "detected_less": "heard less",
        "detected_more": "heard more",
        "newly_detected": "new",
        "similar": "similar",
    }
    for item in results[:60]:
        label = classification_labels.get(item["classification"], item["classification"].replace("_", " "))
        lines.append(f"### {item['label']} — {label}")
        lines.append("")
        lines.append(
            f"- Earlier: {item['baseline_rate'] * 100:.2f}% of moments "
            f"(found in {item['baseline_detected_windows']} moments)"
        )
        lines.append(
            f"- Recent: {item['recent_rate'] * 100:.2f}% of moments "
            f"(found in {item['recent_detected_windows']} moments)"
        )
        lines.append(f"- Difference: {item['difference_pp']:+.2f} points")
        lines.append(f"- Fading: {'yes' if item['fading'] else 'no'}")
        lines.append("")
    lines.extend(["## Limits", ""])
    for warning in comparison["warnings"]:
        lines.append(f"- {warning}")
    archive_phrase = (
        "on the Hush Atlas server" if settings.hosted else "in the local archive"
    )
    generated_phrase = (
        "Generated on the Hush Atlas server by Hush Atlas."
        if settings.hosted
        else "Generated locally by Hush Atlas."
    )
    lines.extend(
        [
            "- These rates come from what the sound reader found. They are not a full count of "
            "the place and do not explain why.",
            f"- Original recordings and saved results remain {archive_phrase} so you can "
            "inspect them again.",
            "",
            generated_phrase,
        ]
    )
    return "\n".join(lines)
