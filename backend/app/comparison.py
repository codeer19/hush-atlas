"""Deterministic baseline/recent comparison engine.

Formula: for each recording, a class detection rate is the share of valid
YAMNet windows whose model score is at or above the comparison threshold. A
group rate is the unweighted mean of its recordings' rates, so long recordings
do not dominate. Percentage-point differences are computed here, never by a
language model.
"""

from __future__ import annotations

import hashlib
import json
import sqlite3
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

import numpy as np

from .analysis import latest_run_for_recording, load_score_matrix
from .config import Settings
from .db import connect, resolve_data_path, utc_now_iso


CHANGE_THRESHOLD_PP = 10.0
MIN_BASELINE_RATE_FOR_FADING = 0.05


class ComparisonError(ValueError):
    status_code = 422


class ComparisonNotFoundError(ComparisonError):
    status_code = 404


@dataclass
class LoadedAnalysis:
    recording_id: int
    run_id: int
    title: str
    recorded_at: str
    duration_seconds: float
    sample_rate: int
    channels: int
    source: str
    audio_format: str
    threshold_used: float
    scores: np.ndarray
    labels: list[str]
    hop_seconds: float
    window_seconds: float
    window_count: int

    @property
    def group_snapshot(self) -> dict[str, Any]:
        return {
            "recording_id": self.recording_id,
            "title": self.title,
            "recorded_at": self.recorded_at,
            "duration_seconds": self.duration_seconds,
            "analysis_run_id": self.run_id,
            "sample_rate": self.sample_rate,
            "channels": self.channels,
            "source": self.source,
            "audio_format": self.audio_format,
        }

    def per_class_rates(self, threshold: float) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        detected = self.scores >= threshold
        rates = detected.mean(axis=0).astype(np.float64)
        counts = detected.sum(axis=0).astype(np.int64)
        peaks = self.scores.max(axis=0).astype(np.float64)
        return rates, counts, peaks

    def peak_window(self, class_index: int) -> tuple[float, float]:
        scores = self.scores[:, class_index]
        index = int(np.argmax(scores))
        start = index * self.hop_seconds
        end = min(self.duration_seconds, start + self.window_seconds)
        return round(float(start), 3), round(float(max(end, start + 0.01)), 3)


@dataclass
class ComparisonComputation:
    threshold: float
    fading_threshold_pp: float
    change_threshold_pp: float
    labels: list[str]
    baseline_group: list[dict[str, Any]]
    recent_group: list[dict[str, Any]]
    baseline_window_count: int
    recent_window_count: int
    warnings: list[str]
    reliability: str
    summary: dict[str, int | str]
    results: list[dict[str, Any]]
    input_hash: str


def _as_utc_datetime(value: str) -> datetime:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _stats_for_group(analyses: list[LoadedAnalysis], threshold: float) -> tuple[np.ndarray, np.ndarray]:
    rates = np.stack([analysis.per_class_rates(threshold)[0] for analysis in analyses])
    detected_counts = np.stack(
        [analysis.per_class_rates(threshold)[1] for analysis in analyses]
    )
    return rates, detected_counts


def _recording_evidence(
    analysis: LoadedAnalysis,
    class_index: int,
    threshold: float,
    label: str,
) -> dict[str, Any]:
    rates, counts, peaks = analysis.per_class_rates(threshold)
    detected_count = int(counts[class_index])
    start, end = analysis.peak_window(class_index)
    return {
        "recording_id": analysis.recording_id,
        "title": analysis.title,
        "recorded_at": analysis.recorded_at,
        "duration_seconds": analysis.duration_seconds,
        "detection_rate": float(rates[class_index]),
        "detected_windows": detected_count,
        "window_count": analysis.window_count,
        "peak_score": float(peaks[class_index]),
        "peak_window_start": start if detected_count > 0 else None,
        "peak_window_end": end if detected_count > 0 else None,
        "class_index": class_index,
        "label": label,
    }


def compute_comparison(
    baseline: list[LoadedAnalysis],
    recent: list[LoadedAnalysis],
    threshold: float,
    fading_threshold_pp: float,
    place_name: str,
    change_threshold_pp: float = CHANGE_THRESHOLD_PP,
) -> ComparisonComputation:
    """Pure, deterministic comparison over already-loaded score matrices."""
    if not baseline:
        raise ComparisonError("The baseline group contains no analyzed recordings.")
    if not recent:
        raise ComparisonError("The recent group contains no analyzed recordings.")
    all_analyses = [*baseline, *recent]
    if len({item.recording_id for item in all_analyses}) != len(all_analyses):
        raise ComparisonError("A recording cannot appear in both the baseline and recent groups.")
    windows = {analysis.window_count for analysis in all_analyses}
    if 0 in windows:
        raise ComparisonError("Every selected recording must have at least one analysis window.")
    if not all(analysis.labels == all_analyses[0].labels for analysis in all_analyses):
        raise ComparisonError("The selected analyses do not use the same class map.")
    labels = all_analyses[0].labels
    if len(labels) != 521:
        raise ComparisonError("The selected analyses do not use the official 521-class map.")

    baseline_rates, baseline_counts = _stats_for_group(baseline, threshold)
    recent_rates, recent_counts = _stats_for_group(recent, threshold)
    baseline_group_rates = baseline_rates.mean(axis=0)
    recent_group_rates = recent_rates.mean(axis=0)
    baseline_group_counts = baseline_counts.sum(axis=0)
    recent_group_counts = recent_counts.sum(axis=0)

    results: list[dict[str, Any]] = []
    for class_index, label in enumerate(labels):
        baseline_rate = float(baseline_group_rates[class_index])
        recent_rate = float(recent_group_rates[class_index])
        if baseline_rate <= 0.0 and recent_rate <= 0.0:
            continue
        difference_pp = (recent_rate - baseline_rate) * 100.0
        if baseline_rate <= 0.0 and recent_rate > 0.0:
            classification = "newly_detected"
        elif difference_pp >= change_threshold_pp:
            classification = "detected_more"
        elif difference_pp <= -change_threshold_pp:
            classification = "detected_less"
        else:
            classification = "similar"
        fading = bool(
            classification == "detected_less"
            and baseline_rate >= MIN_BASELINE_RATE_FOR_FADING
            and (-difference_pp) >= fading_threshold_pp
            and recent_rate < baseline_rate
        )
        notable = bool(classification == "newly_detected" or abs(difference_pp) >= change_threshold_pp)
        results.append(
            {
                "class_index": class_index,
                "label": label,
                "baseline_rate": round(baseline_rate, 6),
                "recent_rate": round(recent_rate, 6),
                "difference_pp": round(difference_pp, 2),
                "baseline_detected_windows": int(baseline_group_counts[class_index]),
                "recent_detected_windows": int(recent_group_counts[class_index]),
                "classification": classification,
                "fading": fading,
                "notable": notable,
                "baseline_recording_rates": [
                    _recording_evidence(item, class_index, threshold, label) for item in baseline
                ],
                "recent_recording_rates": [
                    _recording_evidence(item, class_index, threshold, label) for item in recent
                ],
            }
        )

    order = {
        "detected_less": 0,
        "newly_detected": 1,
        "detected_more": 2,
        "similar": 3,
        "not_detected": 4,
    }
    results.sort(
        key=lambda item: (
            0 if item["fading"] else 1,
            order.get(item["classification"], 5),
            -abs(float(item["difference_pp"])),
            -max(float(item["baseline_rate"]), float(item["recent_rate"])),
            item["class_index"],
        )
    )

    summary = {
        "class_count": len(results),
        "fading_count": sum(1 for item in results if item["fading"]),
        "newly_detected_count": sum(
            1 for item in results if item["classification"] == "newly_detected"
        ),
        "detected_more_count": sum(
            1 for item in results if item["classification"] == "detected_more"
        ),
        "detected_less_count": sum(
            1 for item in results if item["classification"] == "detected_less"
        ),
        "similar_count": sum(1 for item in results if item["classification"] == "similar"),
    }

    warnings = [
        "These rates show what the sound reader found in your recordings, not a full count of "
        "the place. Microphone position, volume, weather, time of day, and recording length can "
        "change what it hears.",
        "A fading sound means the sound reader found it less often in the recent recordings. It "
        "does not show why, or prove that the sound is gone for good.",
    ]
    reliability = "adequate"
    if len(baseline) < 2 or len(recent) < 2:
        reliability = "limited"
        warnings.insert(
            0,
            "One group has fewer than two finished recordings. Treat this comparison as a rough "
            "look, not a reliable result.",
        )
    sources = {analysis.source for analysis in all_analyses}
    sample_rates = {analysis.sample_rate for analysis in all_analyses}
    if len(sources) > 1 or len(sample_rates) > 1:
        warnings.append(
            "These recordings were made with different microphones or audio settings. That can "
            "change what the sound reader finds."
        )
    baseline_dates = [_as_utc_datetime(item.recorded_at) for item in baseline]
    recent_dates = [_as_utc_datetime(item.recorded_at) for item in recent]
    if max(baseline_dates) > min(recent_dates):
        warnings.append(
            "Some recordings in the recent group are older than recordings in the earlier "
            "group. Check your selection if you wanted a before-and-after comparison."
        )
    durations = [analysis.duration_seconds for analysis in all_analyses if analysis.duration_seconds > 0]
    if durations and max(durations) > 3 * max(min(durations), 0.001):
        warnings.append(
            "Recording lengths differ by more than three times. Each recording counts equally, "
            "but they cover very different amounts of time."
        )
    versions = {analysis.scores.shape[1] for analysis in all_analyses}
    if versions != {521}:
        raise ComparisonError("The analyses do not share the official 521-class output.")

    canonical = {
        "place_name": place_name,
        "baseline_runs": sorted(item.run_id for item in baseline),
        "recent_runs": sorted(item.run_id for item in recent),
        "threshold": round(threshold, 6),
        "fading_threshold_pp": round(fading_threshold_pp, 4),
        "change_threshold_pp": round(change_threshold_pp, 4),
    }
    input_hash = hashlib.sha256(
        json.dumps(canonical, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()

    return ComparisonComputation(
        threshold=threshold,
        fading_threshold_pp=fading_threshold_pp,
        change_threshold_pp=change_threshold_pp,
        labels=labels,
        baseline_group=[analysis.group_snapshot for analysis in baseline],
        recent_group=[analysis.group_snapshot for analysis in recent],
        baseline_window_count=sum(analysis.window_count for analysis in baseline),
        recent_window_count=sum(analysis.window_count for analysis in recent),
        warnings=warnings,
        reliability=reliability,
        summary={**summary, "reliability": reliability},
        results=results,
        input_hash=input_hash,
    )


def _load_analyses(
    settings: Settings,
    connection: sqlite3.Connection,
    recording_ids: list[int],
    place_id: int,
) -> list[LoadedAnalysis]:
    loaded: list[LoadedAnalysis] = []
    for recording_id in recording_ids:
        row = connection.execute(
            "SELECT * FROM recordings WHERE id = ?", (recording_id,)
        ).fetchone()
        if not row:
            raise ComparisonError(f"Recording {recording_id} does not exist.")
        if row["place_id"] != place_id:
            raise ComparisonError(
                "Choose recordings from the same place for a comparison."
            )
        if row["analysis_status"] != "completed":
            raise ComparisonError(
                f"“{row['title']}” has not finished finding sounds yet. Find its sounds before "
                "including it in a comparison."
            )
        run = latest_run_for_recording(connection, recording_id, completed_only=True)
        if not run:
            raise ComparisonError(
                f"“{row['title']}” has no finished sound results to compare."
            )
        if not run["score_matrix_path"]:
            raise ComparisonError(
                f"“{row['title']}” has no saved sound results. Run the sound search again."
            )
        try:
            matrix_path = resolve_data_path(settings, run["score_matrix_path"])
            scores, labels, hop, window = load_score_matrix(matrix_path)
        except (OSError, ValueError) as exc:
            raise ComparisonError(
                f"The saved sound results for “{row['title']}” could not be opened: {exc}"
            ) from exc
        loaded.append(
            LoadedAnalysis(
                recording_id=int(row["id"]),
                run_id=int(run["id"]),
                title=row["title"],
                recorded_at=row["recorded_at"],
                duration_seconds=float(run["duration_seconds"] or row["duration_seconds"]),
                sample_rate=int(row["sample_rate"]),
                channels=int(row["channels"]),
                source=row["source"],
                audio_format=row["audio_format"],
                threshold_used=float(run["threshold"]),
                scores=scores,
                labels=labels,
                hop_seconds=hop,
                window_seconds=window,
                window_count=int(scores.shape[0]),
            )
        )
    return loaded


def create_comparison(settings: Settings, payload: dict[str, Any]) -> int:
    place_id = int(payload["place_id"])
    baseline_ids = [int(item) for item in payload["baseline_recording_ids"]]
    recent_ids = [int(item) for item in payload["recent_recording_ids"]]
    if set(baseline_ids) & set(recent_ids):
        raise ComparisonError("A recording cannot be selected in both groups.")
    threshold = float(payload.get("threshold") or settings.default_score_threshold)
    fading_threshold = float(
        payload.get("fading_threshold_pp") or settings.default_fading_threshold_pp
    )
    if not 0.01 <= threshold <= 0.99:
        raise ComparisonError("The comparison score threshold must be between 0.01 and 0.99.")
    if not 1.0 <= fading_threshold <= 100.0:
        raise ComparisonError("The fading threshold must be between 1 and 100 percentage points.")

    with connect(settings) as connection:
        place = connection.execute("SELECT * FROM places WHERE id = ?", (place_id,)).fetchone()
        if not place:
            raise ComparisonNotFoundError(f"Place {place_id} does not exist.")
        baseline = _load_analyses(settings, connection, baseline_ids, place_id)
        recent = _load_analyses(settings, connection, recent_ids, place_id)
        selected_rows = connection.execute(
            f"""
            SELECT * FROM recordings
             WHERE id IN ({','.join('?' for _ in [*baseline_ids, *recent_ids])})
            """,
            [*baseline_ids, *recent_ids],
        ).fetchall()
        computation = compute_comparison(
            baseline,
            recent,
            threshold,
            fading_threshold,
            place["name"],
        )
        created_at = utc_now_iso()
        model_name = "YAMNet (AudioSet)"
        model_versions = {analysis.run_id for analysis in baseline + recent}
        version_rows = connection.execute(
            f"""
            SELECT model_version FROM analysis_runs
             WHERE id IN ({','.join('?' for _ in model_versions)})
            """,
            sorted(model_versions),
        ).fetchall()
        versions = [row["model_version"] for row in version_rows if row["model_version"]]
        model_version = versions[0] if versions and len(set(versions)) == 1 else (
            "mixed" if len(set(versions)) > 1 else None
        )
        cursor = connection.execute(
            """
            INSERT INTO comparisons(
                place_id, threshold, fading_threshold_pp, change_threshold_pp,
                baseline_recording_ids, recent_recording_ids, baseline_run_ids,
                recent_run_ids, baseline_group_json, recent_group_json,
                baseline_window_count, recent_window_count, model_name, model_version,
                warnings, summary, input_hash, created_at,
                baseline_session_id, recent_session_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                place_id,
                threshold,
                fading_threshold,
                computation.change_threshold_pp,
                json.dumps(baseline_ids),
                json.dumps(recent_ids),
                json.dumps([analysis.run_id for analysis in baseline]),
                json.dumps([analysis.run_id for analysis in recent]),
                json.dumps(computation.baseline_group),
                json.dumps(computation.recent_group),
                computation.baseline_window_count,
                computation.recent_window_count,
                model_name,
                model_version,
                json.dumps(computation.warnings),
                json.dumps(computation.summary),
                computation.input_hash,
                created_at,
                payload.get("baseline_session_id"),
                payload.get("recent_session_id"),
            ),
        )
        comparison_id = int(cursor.lastrowid)
        connection.executemany(
            """
            INSERT INTO comparison_results(
                comparison_id, class_index, class_label, baseline_rate, recent_rate,
                difference_pp, baseline_detected_windows, recent_detected_windows,
                classification, fading, baseline_recording_rates, recent_recording_rates,
                evidence
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [
                (
                    comparison_id,
                    result["class_index"],
                    result["label"],
                    result["baseline_rate"],
                    result["recent_rate"],
                    result["difference_pp"],
                    result["baseline_detected_windows"],
                    result["recent_detected_windows"],
                    result["classification"],
                    1 if result["fading"] else 0,
                    json.dumps(result["baseline_recording_rates"]),
                    json.dumps(result["recent_recording_rates"]),
                    json.dumps({"notable": result["notable"]}),
                )
                for result in computation.results
            ],
        )
        connection.commit()
        del selected_rows
    return comparison_id


def _group_from_snapshots(snapshot: list[dict[str, Any]], window_count: int) -> dict[str, Any]:
    dates = [_as_utc_datetime(item["recorded_at"]) for item in snapshot]
    return {
        "recording_ids": [item["recording_id"] for item in snapshot],
        "recordings": snapshot,
        "recording_count": len(snapshot),
        "window_count": window_count,
        "date_start": min(dates).isoformat() if dates else None,
        "date_end": max(dates).isoformat() if dates else None,
    }


def get_comparison(settings: Settings, comparison_id: int) -> dict[str, Any]:
    with connect(settings) as connection:
        comparison = connection.execute(
            """
            SELECT c.*, p.name AS place_name
              FROM comparisons c JOIN places p ON p.id = c.place_id
             WHERE c.id = ?
            """,
            (comparison_id,),
        ).fetchone()
        if not comparison:
            raise ComparisonNotFoundError(
                f"Comparison {comparison_id} does not exist or its place was deleted."
            )
        rows = connection.execute(
            "SELECT * FROM comparison_results WHERE comparison_id = ?",
            (comparison_id,),
        ).fetchall()
        context_rows = connection.execute(
            """
            SELECT s.recording_id, s.id AS stop_id, s.name AS stop_name,
                   s.stop_order, s.observation, w.id AS session_id,
                   w.title AS session_title, w.status AS session_status,
                   r.id AS route_id, r.name AS route_name
              FROM walk_stops s
              JOIN walk_sessions w ON w.id = s.session_id
              LEFT JOIN routes r ON r.id = w.route_id
             WHERE s.recording_id IN (
                 SELECT CAST(value AS INTEGER) FROM json_each(?)
                 UNION
                 SELECT CAST(value AS INTEGER) FROM json_each(?)
             )
             ORDER BY w.id DESC, s.stop_order
            """,
            (comparison["baseline_recording_ids"], comparison["recent_recording_ids"]),
        ).fetchall()

    stop_context = [
        {
            "stop_id": row["stop_id"],
            "stop_name": row["stop_name"],
            "stop_order": row["stop_order"],
            "observation": row["observation"],
            "session_id": row["session_id"],
            "session_title": row["session_title"],
            "session_status": row["session_status"],
            "route_id": row["route_id"],
            "route_name": row["route_name"],
            "recording_id": row["recording_id"],
        }
        for row in context_rows
    ]
    results: list[dict[str, Any]] = []
    for row in rows:
        evidence = json.loads(row["evidence"] or "{}")
        results.append(
            {
                "class_index": row["class_index"],
                "label": row["class_label"],
                "baseline_rate": row["baseline_rate"],
                "recent_rate": row["recent_rate"],
                "difference_pp": row["difference_pp"],
                "baseline_detected_windows": row["baseline_detected_windows"],
                "recent_detected_windows": row["recent_detected_windows"],
                "classification": row["classification"],
                "fading": bool(row["fading"]),
                "notable": bool(evidence.get("notable", False)),
                "baseline_recording_rates": json.loads(row["baseline_recording_rates"] or "[]"),
                "recent_recording_rates": json.loads(row["recent_recording_rates"] or "[]"),
            }
        )
    order = {
        "detected_less": 0,
        "newly_detected": 1,
        "detected_more": 2,
        "similar": 3,
        "not_detected": 4,
    }
    results.sort(
        key=lambda item: (
            0 if item["fading"] else 1,
            order.get(item["classification"], 5),
            -abs(float(item["difference_pp"])),
            -max(float(item["baseline_rate"]), float(item["recent_rate"])),
            item["class_index"],
        )
    )
    summary = json.loads(comparison["summary"] or "{}")
    reliability = summary.get("reliability") or (
        "limited"
        if len(json.loads(comparison["baseline_recording_ids"])) < 2
        or len(json.loads(comparison["recent_recording_ids"])) < 2
        else "adequate"
    )
    return {
        "id": comparison["id"],
        "place_id": comparison["place_id"],
        "place_name": comparison["place_name"],
        "baseline_session_id": comparison["baseline_session_id"],
        "recent_session_id": comparison["recent_session_id"],
        "stop_context": stop_context,
        "threshold": comparison["threshold"],
        "fading_threshold_pp": comparison["fading_threshold_pp"],
        "change_threshold_pp": comparison["change_threshold_pp"],
        "baseline": _group_from_snapshots(
            json.loads(comparison["baseline_group_json"]),
            comparison["baseline_window_count"],
        ),
        "recent": _group_from_snapshots(
            json.loads(comparison["recent_group_json"]),
            comparison["recent_window_count"],
        ),
        "warnings": json.loads(comparison["warnings"] or "[]"),
        "reliability": reliability,
        "summary": summary,
        "results": results,
        "model_name": comparison["model_name"],
        "model_version": comparison["model_version"],
        "input_hash": comparison["input_hash"],
        "created_at": comparison["created_at"],
    }


def list_comparisons(settings: Settings, place_id: int | None = None) -> list[dict[str, Any]]:
    with connect(settings) as connection:
        params: list[Any] = []
        where = ""
        if place_id is not None:
            where = "WHERE c.place_id = ?"
            params.append(place_id)
        rows = connection.execute(
            f"""
            SELECT c.*, p.name AS place_name,
                   (SELECT COUNT(*) FROM comparison_results r
                     WHERE r.comparison_id = c.id AND r.fading = 1) AS fading_count,
                   (SELECT COUNT(*) FROM comparison_results r
                     WHERE r.comparison_id = c.id
                       AND (r.classification = 'newly_detected'
                            OR ABS(r.difference_pp) >= c.change_threshold_pp)) AS notable_count
              FROM comparisons c JOIN places p ON p.id = c.place_id
              {where}
             ORDER BY c.id DESC
             LIMIT 100
            """,
            params,
        ).fetchall()
    return [
        {
            "id": row["id"],
            "place_id": row["place_id"],
            "place_name": row["place_name"],
            "created_at": row["created_at"],
            "threshold": row["threshold"],
            "baseline_count": len(json.loads(row["baseline_recording_ids"])),
            "recent_count": len(json.loads(row["recent_recording_ids"])),
            "fading_count": row["fading_count"],
            "notable_count": row["notable_count"],
        }
        for row in rows
    ]


def notable_changes(settings: Settings, limit: int = 6) -> list[dict[str, Any]]:
    with connect(settings) as connection:
        rows = connection.execute(
            """
            SELECT c.id AS comparison_id, c.place_id, p.name AS place_name,
                   c.created_at AS comparison_created_at, r.class_label, r.class_index,
                   r.baseline_rate, r.recent_rate, r.difference_pp,
                   r.classification, r.fading
              FROM comparison_results r
              JOIN comparisons c ON c.id = r.comparison_id
              JOIN places p ON p.id = c.place_id
             WHERE (r.classification = 'newly_detected'
                    OR ABS(r.difference_pp) >= c.change_threshold_pp)
               AND p.is_demo = 0
             ORDER BY r.fading DESC, ABS(r.difference_pp) DESC, c.id DESC
             LIMIT ?
            """,
            (limit,),
        ).fetchall()
    return [
        {
            "comparison_id": row["comparison_id"],
            "place_id": row["place_id"],
            "place_name": row["place_name"],
            "comparison_created_at": row["comparison_created_at"],
            "class_index": row["class_index"],
            "label": row["class_label"],
            "baseline_rate": row["baseline_rate"],
            "recent_rate": row["recent_rate"],
            "difference_pp": row["difference_pp"],
            "classification": row["classification"],
            "fading": bool(row["fading"]),
        }
        for row in rows
    ]
