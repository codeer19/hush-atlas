"""Routes, walk sessions, stop progress and repeat visits.

A route is the reusable, ordered set of listening points. A walk session is one
visit to that route. Recordings remain ordinary archive rows and are linked to
the stop that produced them, so the existing analysis and playback pipeline is
unchanged.
"""

from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timezone
from typing import Any

from .analysis import latest_run_for_recording, top_classes_for_recording
from .comparison import (
    ComparisonError,
    ComparisonNotFoundError,
    create_comparison,
    get_comparison,
)
from .config import Settings
from .db import connect, utc_now_iso
from .missions import MISSION_BY_KEY, mission_for, mission_key_or_error


STOP_STATUSES = {
    "ready_to_listen",
    "listening",
    "ready_to_record",
    "recording",
    "recorded",
    "analysis_pending",
    "analyzed",
    "analysis_failed",
    "reviewed",
    "completed",
}

STOP_STATUS_LABELS = {
    "ready_to_listen": "Ready to listen",
    "listening": "Listening",
    "ready_to_record": "Ready to record",
    "recording": "Recording",
    "recorded": "Recording saved",
    "analysis_pending": "Finding sounds",
    "analyzed": "Sounds found",
    "analysis_failed": "Sound search failed",
    "reviewed": "Reviewed",
    "completed": "Completed",
}

WALK_STATUS_LABELS = {
    "active": "In progress",
    "paused": "Paused",
    "completed": "Completed",
}

ANALYSIS_STATUS_LABELS = {
    "not_analyzed": "Not searched yet",
    "queued": "Waiting to search",
    "running": "Finding sounds",
    "completed": "Sounds found",
    "failed": "Search did not finish",
}


class WalkError(ValueError):
    status_code = 422


class WalkNotFoundError(WalkError):
    status_code = 404


def _as_utc(value: str) -> datetime:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _clean_name(value: str, field: str = "name", maximum: int = 120) -> str:
    cleaned = (value or "").strip()
    if not cleaned:
        raise WalkError(f"Give this {field} a name.")
    if len(cleaned) > maximum:
        raise WalkError(f"This {field} may be at most {maximum} characters.")
    return cleaned


def _coordinate(value: Any, kind: str) -> float | None:
    if value is None or value == "":
        return None
    try:
        number = float(value)
    except (TypeError, ValueError) as exc:
        raise WalkError(f"The optional {kind} is not a valid number.") from exc
    limit = 90 if kind == "latitude" else 180
    if not -limit <= number <= limit:
        raise WalkError(f"The optional {kind} must be between -{limit} and {limit}.")
    return number


def list_routes(settings: Settings) -> list[dict[str, Any]]:
    with connect(settings) as connection:
        rows = connection.execute(
            """
            SELECT r.*, p.name AS place_name,
                   (SELECT COUNT(*) FROM route_stops s WHERE s.route_id = r.id) AS stop_count,
                   (SELECT COUNT(*) FROM walk_sessions w
                     WHERE w.route_id = r.id AND w.status = 'completed') AS completed_visit_count,
                   (SELECT MAX(w.completed_at) FROM walk_sessions w
                     WHERE w.route_id = r.id AND w.status = 'completed') AS last_completed_at
              FROM routes r JOIN places p ON p.id = r.place_id
             WHERE p.is_demo = 0
             ORDER BY COALESCE(last_completed_at, r.updated_at) DESC, r.id DESC
            """
        ).fetchall()
    return [
        {
            "id": row["id"],
            "place_id": row["place_id"],
            "place_name": row["place_name"],
            "name": row["name"],
            "description": row["description"],
            "notes": row["notes"],
            "recording_duration_seconds": row["recording_duration_seconds"],
            "stop_count": row["stop_count"],
            "completed_visit_count": row["completed_visit_count"],
            "last_completed_at": row["last_completed_at"],
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
        }
        for row in rows
    ]


def get_route(settings: Settings, route_id: int) -> dict[str, Any] | None:
    with connect(settings) as connection:
        row = connection.execute(
            """
            SELECT r.*, p.name AS place_name, p.description AS place_description,
                   p.is_demo,
                   (SELECT COUNT(*) FROM route_stops s
                     WHERE s.route_id = r.id) AS stop_count,
                   (SELECT COUNT(*) FROM walk_sessions w
                     WHERE w.route_id = r.id AND w.status = 'completed')
                     AS completed_visit_count,
                   (SELECT MAX(w.completed_at) FROM walk_sessions w
                     WHERE w.route_id = r.id AND w.status = 'completed')
                     AS last_completed_at
              FROM routes r JOIN places p ON p.id = r.place_id
             WHERE r.id = ?
            """,
            (route_id,),
        ).fetchone()
        if not row:
            return None
        stops = connection.execute(
            "SELECT * FROM route_stops WHERE route_id = ? ORDER BY stop_order, id",
            (route_id,),
        ).fetchall()
        sessions = connection.execute(
            """
            SELECT id, title, status, started_at, completed_at
              FROM walk_sessions WHERE route_id = ?
             ORDER BY started_at DESC, id DESC LIMIT 30
            """,
            (route_id,),
        ).fetchall()
        previous = connection.execute(
            """
            SELECT id, title, status, started_at, completed_at
              FROM walk_sessions
             WHERE route_id = ? AND status = 'completed'
             ORDER BY completed_at DESC, id DESC LIMIT 1
            """,
            (route_id,),
        ).fetchone()
    return {
        "id": row["id"],
        "place_id": row["place_id"],
        "place_name": row["place_name"],
        "place_description": row["place_description"],
        "is_demo": bool(row["is_demo"]),
        "name": row["name"],
        "description": row["description"],
        "notes": row["notes"],
        "recording_duration_seconds": row["recording_duration_seconds"],
        "stop_count": row["stop_count"],
        "completed_visit_count": row["completed_visit_count"],
        "last_completed_at": row["last_completed_at"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
        "stops": [
            {
                "id": stop["id"],
                "stop_order": stop["stop_order"],
                "name": stop["name"],
                "notes": stop["notes"],
                "latitude": stop["latitude"],
                "longitude": stop["longitude"],
            }
            for stop in stops
        ],
        "sessions": [dict(session) for session in sessions],
        "previous_session": dict(previous) if previous else None,
    }


def create_route(
    settings: Settings,
    *,
    place_id: int,
    name: str,
    stops: list[dict[str, Any]],
    description: str = "",
    notes: str = "",
    recording_duration_seconds: float = 30.0,
) -> int:
    cleaned_stops = stops[:12]
    if not cleaned_stops:
        raise WalkError("A route needs at least one stopping point.")
    if not 5 <= recording_duration_seconds <= 180:
        raise WalkError("Suggested recording duration must be between 5 and 180 seconds.")
    now = utc_now_iso()
    with connect(settings) as connection:
        place = connection.execute("SELECT id FROM places WHERE id = ?", (place_id,)).fetchone()
        if not place:
            raise WalkNotFoundError(f"Place {place_id} does not exist.")
        cursor = connection.execute(
            """
            INSERT INTO routes(
                place_id, name, description, notes, recording_duration_seconds,
                created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                place_id,
                _clean_name(name, "route", 160),
                description.strip()[:4000],
                notes.strip()[:4000],
                float(recording_duration_seconds),
                now,
                now,
            ),
        )
        route_id = int(cursor.lastrowid)
        for order, stop in enumerate(cleaned_stops):
            connection.execute(
                """
                INSERT INTO route_stops(
                    route_id, stop_order, name, notes, latitude, longitude
                ) VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    route_id,
                    order,
                    _clean_name(str(stop.get("name", "")), "stop"),
                    str(stop.get("notes", "")).strip()[:2000],
                    _coordinate(stop.get("latitude"), "latitude"),
                    _coordinate(stop.get("longitude"), "longitude"),
                ),
            )
        connection.commit()
    return route_id


def _recording_summary(
    connection: sqlite3.Connection, recording: sqlite3.Row
) -> dict[str, Any]:
    place = connection.execute(
        "SELECT name FROM places WHERE id = ?", (recording["place_id"],)
    ).fetchone()
    return {
        "id": recording["id"],
        "place_id": recording["place_id"],
        "place_name": place["name"] if place else "",
        "title": recording["title"],
        "recorded_at": recording["recorded_at"],
        "duration_seconds": recording["duration_seconds"],
        "audio_format": recording["audio_format"],
        "sample_rate": recording["sample_rate"],
        "channels": recording["channels"],
        "source": recording["source"],
        "analysis_status": recording["analysis_status"],
        "analysis_error": recording["analysis_error"],
        "audio_url": f"/api/recordings/{recording['id']}/audio",
        "top_classes": top_classes_for_recording(connection, int(recording["id"]), limit=8),
    }


def _stop_payload(connection: sqlite3.Connection, row: sqlite3.Row) -> dict[str, Any]:
    recording = None
    if row["recording_id"]:
        recording_row = connection.execute(
            "SELECT * FROM recordings WHERE id = ?", (row["recording_id"],)
        ).fetchone()
        if recording_row:
            recording = _recording_summary(connection, recording_row)
    status = row["status"]
    interrupted = bool(status == "recording" and recording is None)
    return {
        "id": row["id"],
        "session_id": row["session_id"],
        "route_stop_id": row["route_stop_id"],
        "stop_order": row["stop_order"],
        "name": row["name"],
        "latitude": row["latitude"],
        "longitude": row["longitude"],
        "observation": row["observation"],
        "status": status,
        "status_label": STOP_STATUS_LABELS.get(status, status),
        "interrupted_recording": interrupted,
        "recording": recording,
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def _progress(stops: list[dict[str, Any]]) -> dict[str, int]:
    recorded = [stop for stop in stops if stop["recording"]]
    analyzed = [
        stop
        for stop in recorded
        if stop["recording"]["analysis_status"] == "completed"
    ]
    failed = [
        stop
        for stop in recorded
        if stop["recording"]["analysis_status"] == "failed"
    ]
    reviewed = [
        stop for stop in stops if stop["status"] in {"reviewed", "completed"}
    ]
    return {
        "total_stops": len(stops),
        "recorded_stops": len(recorded),
        "analyzed_stops": len(analyzed),
        "failed_analysis_stops": len(failed),
        "reviewed_stops": len(reviewed),
        "remaining_stops": max(0, len(stops) - len(reviewed)),
    }


def _previous_visit(
    connection: sqlite3.Connection, session_row: sqlite3.Row
) -> dict[str, Any] | None:
    if not session_row["route_id"]:
        return None
    previous = connection.execute(
        """
        SELECT * FROM walk_sessions
         WHERE route_id = ? AND id != ? AND status = 'completed'
         ORDER BY completed_at DESC, id DESC LIMIT 1
        """,
        (session_row["route_id"], session_row["id"]),
    ).fetchone()
    if not previous:
        return None
    stops = connection.execute(
        "SELECT * FROM walk_stops WHERE session_id = ? ORDER BY stop_order, id",
        (previous["id"],),
    ).fetchall()
    return {
        "id": previous["id"],
        "title": previous["title"],
        "status": previous["status"],
        "started_at": previous["started_at"],
        "completed_at": previous["completed_at"],
        "stops": [_stop_payload(connection, stop) for stop in stops],
    }


def get_walk(settings: Settings, session_id: int) -> dict[str, Any] | None:
    with connect(settings) as connection:
        row = connection.execute(
            """
            SELECT w.*, p.name AS place_name, p.description AS place_description,
                   p.is_demo, r.name AS route_name, r.recording_duration_seconds
              FROM walk_sessions w
              JOIN places p ON p.id = w.place_id
              LEFT JOIN routes r ON r.id = w.route_id
             WHERE w.id = ?
            """,
            (session_id,),
        ).fetchone()
        if not row:
            return None
        stop_rows = connection.execute(
            "SELECT * FROM walk_stops WHERE session_id = ? ORDER BY stop_order, id",
            (session_id,),
        ).fetchall()
        stops = [_stop_payload(connection, stop) for stop in stop_rows]
        previous = _previous_visit(connection, row)
    mission = mission_for(row["mission_key"])
    progress = _progress(stops)
    return {
        "id": row["id"],
        "mission_key": row["mission_key"],
        "mission_title": mission["title"] if mission else row["mission_key"],
        "mission_short_description": mission["short_description"] if mission else "",
        "mission_comparison_mode": mission["comparison_mode"] if mission else "",
        "route_id": row["route_id"],
        "route_name": row["route_name"],
        "recording_duration_seconds": row["recording_duration_seconds"] or 30.0,
        "place_id": row["place_id"],
        "place_name": row["place_name"],
        "place_description": row["place_description"],
        "is_demo": bool(row["is_demo"]),
        "title": row["title"],
        "status": row["status"],
        "notes": row["notes"],
        "started_at": row["started_at"],
        "paused_at": row["paused_at"],
        "completed_at": row["completed_at"],
        "updated_at": row["updated_at"],
        "progress": progress,
        "stops": stops,
        "previous_visit": previous,
    }


def list_walks(
    settings: Settings, status: str | None = None, limit: int = 30
) -> list[dict[str, Any]]:
    if status is not None and status not in {"active", "paused", "completed"}:
        raise WalkError("Walk status must be active, paused or completed.")
    where = "WHERE w.status = ?" if status else ""
    params: list[Any] = [status] if status else []
    params.append(min(max(limit, 1), 100))
    with connect(settings) as connection:
        rows = connection.execute(
            f"""
            SELECT w.*, p.name AS place_name, p.is_demo, r.name AS route_name,
                   (SELECT COUNT(*) FROM walk_stops s WHERE s.session_id = w.id) AS stop_count,
                   (SELECT COUNT(*) FROM walk_stops s
                     WHERE s.session_id = w.id AND s.recording_id IS NOT NULL) AS recorded_count,
                   (SELECT COUNT(*) FROM walk_stops s
                     JOIN recordings rec ON rec.id = s.recording_id
                     WHERE s.session_id = w.id AND rec.analysis_status = 'completed')
                       AS analyzed_count
              FROM walk_sessions w
              JOIN places p ON p.id = w.place_id
              LEFT JOIN routes r ON r.id = w.route_id
              {where}
             ORDER BY CASE w.status WHEN 'active' THEN 0 WHEN 'paused' THEN 1 ELSE 2 END,
                      COALESCE(w.completed_at, w.updated_at) DESC, w.id DESC
             LIMIT ?
            """,
            params,
        ).fetchall()
    return [
        {
            "id": row["id"],
            "mission_key": row["mission_key"],
            "mission_title": (
                MISSION_BY_KEY[row["mission_key"]]["title"]
                if row["mission_key"] in MISSION_BY_KEY
                else row["mission_key"]
            ),
            "title": row["title"],
            "status": row["status"],
            "place_id": row["place_id"],
            "place_name": row["place_name"],
            "is_demo": bool(row["is_demo"]),
            "route_id": row["route_id"],
            "route_name": row["route_name"],
            "started_at": row["started_at"],
            "completed_at": row["completed_at"],
            "stop_count": row["stop_count"],
            "recorded_count": row["recorded_count"],
            "analyzed_count": row["analyzed_count"],
        }
        for row in rows
    ]


def create_walk(settings: Settings, payload: dict[str, Any]) -> dict[str, Any]:
    try:
        mission = mission_key_or_error(str(payload.get("mission_key", "")))
    except ValueError as exc:
        raise WalkError(str(exc)) from exc
    route_id = payload.get("route_id")
    place_id = payload.get("place_id")
    now = utc_now_iso()

    route_row = None
    if route_id is not None:
        with connect(settings) as connection:
            route_row = connection.execute(
                "SELECT * FROM routes WHERE id = ?", (int(route_id),)
            ).fetchone()
        if not route_row:
            raise WalkNotFoundError(f"Route {route_id} does not exist.")
        if place_id is not None and int(place_id) != int(route_row["place_id"]):
            raise WalkError("The selected route belongs to a different place.")
        place_id = int(route_row["place_id"])
    else:
        if place_id is None:
            raise WalkError("Choose or create a place before starting a Soundwalk.")
        place_id = int(place_id)

    with connect(settings) as connection:
        place = connection.execute(
            "SELECT * FROM places WHERE id = ?", (place_id,)
        ).fetchone()
        if not place:
            raise WalkNotFoundError(f"Place {place_id} does not exist.")
        if route_row is None:
            supplied = payload.get("stops") or []
            if not supplied:
                supplied = [
                    {"name": name}
                    for name in mission["default_stop_names"][: mission["suggested_stops"]]
                ]
            maximum = int(mission["maximum_stops"])
            if len(supplied) > maximum:
                raise WalkError(
                    f"{mission['title']} supports up to {maximum} stops in one session."
                )
            route_name = payload.get("route_name") or f"{place['name']} · {mission['title']}"
            route_id = create_route(
                settings,
                place_id=place_id,
                name=str(route_name),
                description=str(payload.get("route_description", "")),
                notes=str(payload.get("route_notes", "")),
                recording_duration_seconds=float(
                    payload.get("recording_duration_seconds") or 30.0
                ),
                stops=[
                    {
                        "name": item.get("name", ""),
                        "notes": item.get("notes", ""),
                        "latitude": item.get("latitude"),
                        "longitude": item.get("longitude"),
                    }
                    for item in supplied
                ],
            )
            with connect(settings) as route_connection:
                route_row = route_connection.execute(
                    "SELECT * FROM routes WHERE id = ?", (route_id,)
                ).fetchone()
        if route_row is None:
            raise WalkError("The route could not be prepared.")

        route_stops = connection.execute(
            "SELECT * FROM route_stops WHERE route_id = ? ORDER BY stop_order, id",
            (int(route_id),),
        ).fetchall()
        if not route_stops:
            raise WalkError("The selected route has no stopping points.")

        title = str(payload.get("title") or "").strip()
        if not title:
            title = f"{mission['title']} · {place['name']}"
        cursor = connection.execute(
            """
            INSERT INTO walk_sessions(
                mission_key, route_id, place_id, title, status, notes,
                started_at, updated_at
            ) VALUES (?, ?, ?, ?, 'active', ?, ?, ?)
            """,
            (
                mission["key"],
                int(route_id),
                place_id,
                title[:200],
                str(payload.get("notes", "")).strip()[:4000],
                now,
                now,
            ),
        )
        session_id = int(cursor.lastrowid)
        for order, stop in enumerate(route_stops):
            connection.execute(
                """
                INSERT INTO walk_stops(
                    session_id, route_stop_id, stop_order, name, latitude, longitude,
                    observation, status, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, '', 'ready_to_listen', ?, ?)
                """,
                (
                    session_id,
                    stop["id"],
                    order,
                    stop["name"],
                    stop["latitude"],
                    stop["longitude"],
                    now,
                    now,
                ),
            )
        connection.commit()
    result = get_walk(settings, session_id)
    assert result is not None
    return result


def update_walk(
    settings: Settings,
    session_id: int,
    *,
    status: str | None = None,
    notes: str | None = None,
) -> dict[str, Any] | None:
    updates: list[str] = []
    params: list[Any] = []
    now = utc_now_iso()
    if status is not None:
        if status not in {"active", "paused", "completed"}:
            raise WalkError("Walk status must be active, paused or completed.")
        updates.append("status = ?")
        params.append(status)
        if status == "paused":
            updates.append("paused_at = ?")
            params.append(now)
        elif status == "active":
            updates.append("paused_at = NULL")
        elif status == "completed":
            updates.append("completed_at = ?")
            params.append(now)
    if notes is not None:
        if len(notes) > 4000:
            raise WalkError("Walk notes may be at most 4,000 characters.")
        updates.append("notes = ?")
        params.append(notes.strip())
    if not updates:
        return get_walk(settings, session_id)
    updates.append("updated_at = ?")
    params.extend([now, session_id])
    with connect(settings) as connection:
        existing = connection.execute(
            "SELECT id FROM walk_sessions WHERE id = ?", (session_id,)
        ).fetchone()
        if not existing:
            return None
        connection.execute(
            f"UPDATE walk_sessions SET {', '.join(updates)} WHERE id = ?", params
        )
        connection.commit()
    return get_walk(settings, session_id)


def update_walk_stop(
    settings: Settings,
    session_id: int,
    stop_id: int,
    *,
    observation: str | None = None,
    status: str | None = None,
) -> dict[str, Any]:
    if status is not None and status not in STOP_STATUSES:
        raise WalkError("Unknown stop state.")
    now = utc_now_iso()
    with connect(settings) as connection:
        row = connection.execute(
            "SELECT * FROM walk_stops WHERE id = ? AND session_id = ?",
            (stop_id, session_id),
        ).fetchone()
        if not row:
            raise WalkNotFoundError("Stop not found in this walk.")
        recording = None
        if row["recording_id"]:
            recording = connection.execute(
                "SELECT * FROM recordings WHERE id = ?", (row["recording_id"],)
            ).fetchone()
        if status in {
            "recorded",
            "analysis_pending",
            "analyzed",
            "analysis_failed",
            "reviewed",
            "completed",
        } and not recording:
            raise WalkError("Save a recording at this stop before advancing it.")
        if status == "analyzed" and (not recording or recording["analysis_status"] != "completed"):
            raise WalkError("The recording has not completed sound analysis.")
        if status == "analysis_failed" and (
            not recording or recording["analysis_status"] != "failed"
        ):
            raise WalkError("The recording does not have a failed analysis.")
        updates: list[str] = []
        params: list[Any] = []
        if observation is not None:
            if len(observation) > 2000:
                raise WalkError("Observations may be at most 2,000 characters.")
            updates.append("observation = ?")
            params.append(observation.strip())
        if status is not None:
            updates.append("status = ?")
            params.append(status)
        if not updates:
            return _get_stop(settings, session_id, stop_id)
        updates.append("updated_at = ?")
        params.extend([now, stop_id, session_id])
        connection.execute(
            f"UPDATE walk_stops SET {', '.join(updates)} WHERE id = ? AND session_id = ?",
            params,
        )
        connection.commit()
    return _get_stop(settings, session_id, stop_id)


def _get_stop(settings: Settings, session_id: int, stop_id: int) -> dict[str, Any]:
    with connect(settings) as connection:
        row = connection.execute(
            "SELECT * FROM walk_stops WHERE id = ? AND session_id = ?",
            (stop_id, session_id),
        ).fetchone()
        if not row:
            raise WalkNotFoundError("Stop not found in this walk.")
        return _stop_payload(connection, row)


def attach_recording(
    settings: Settings, session_id: int, stop_id: int, recording_id: int
) -> None:
    now = utc_now_iso()
    with connect(settings) as connection:
        stop = connection.execute(
            "SELECT * FROM walk_stops WHERE id = ? AND session_id = ?",
            (stop_id, session_id),
        ).fetchone()
        if not stop:
            raise WalkNotFoundError("Stop not found in this walk.")
        recording = connection.execute(
            "SELECT * FROM recordings WHERE id = ?", (recording_id,)
        ).fetchone()
        if not recording:
            raise WalkNotFoundError("Recording not found.")
        session = connection.execute(
            "SELECT place_id FROM walk_sessions WHERE id = ?", (session_id,)
        ).fetchone()
        if not session or int(session["place_id"]) != int(recording["place_id"]):
            raise WalkError("The recording belongs to a different place than this walk.")
        connection.execute(
            "UPDATE walk_stops SET recording_id = ?, status = 'recorded', updated_at = ? "
            "WHERE id = ? AND session_id = ?",
            (recording_id, now, stop_id, session_id),
        )
        connection.execute(
            "UPDATE recordings SET walk_stop_id = ?, updated_at = ? WHERE id = ?",
            (stop_id, now, recording_id),
        )
        connection.commit()


def delete_walk(settings: Settings, session_id: int) -> bool:
    with connect(settings) as connection:
        row = connection.execute(
            "SELECT id FROM walk_sessions WHERE id = ?", (session_id,)
        ).fetchone()
        if not row:
            return False
        connection.execute("DELETE FROM walk_sessions WHERE id = ?", (session_id,))
        connection.commit()
    return True


def repeat_walk(settings: Settings, session_id: int) -> dict[str, Any]:
    with connect(settings) as connection:
        session = connection.execute(
            "SELECT * FROM walk_sessions WHERE id = ?", (session_id,)
        ).fetchone()
        if not session:
            raise WalkNotFoundError("Walk not found.")
        if not session["route_id"]:
            raise WalkError("This walk has no saved route to repeat.")
        route = connection.execute(
            "SELECT * FROM routes WHERE id = ?", (session["route_id"],)
        ).fetchone()
        if not route:
            raise WalkError("The saved route no longer exists.")
    title = f"Repeat · {str(session['title']).replace('Repeat · ', '')}"
    return create_walk(
        settings,
        {
            "mission_key": session["mission_key"],
            "place_id": session["place_id"],
            "route_id": session["route_id"],
            "title": title[:200],
        },
    )


def walk_map(settings: Settings, session_id: int) -> dict[str, Any] | None:
    walk = get_walk(settings, session_id)
    if walk is None:
        return None
    class_labels: dict[int, str] = {}
    stops: list[dict[str, Any]] = []
    with connect(settings) as connection:
        for stop in walk["stops"]:
            payload = dict(stop)
            recording = stop["recording"]
            events: list[dict[str, Any]] = []
            waveform: list[float] = []
            run_id = None
            if recording:
                recording_row = connection.execute(
                    "SELECT * FROM recordings WHERE id = ?", (recording["id"],)
                ).fetchone()
                if recording_row:
                    waveform = json.loads(recording_row["waveform_peaks"] or "[]")
                run = latest_run_for_recording(
                    connection, int(recording["id"]), completed_only=True
                )
                if run:
                    run_id = int(run["id"])
                    allowed = [item["class_index"] for item in recording["top_classes"]]
                    if allowed:
                        event_rows = connection.execute(
                            f"""
                            SELECT class_index, class_label, start_seconds, end_seconds,
                                   model_score
                              FROM event_detections
                             WHERE analysis_run_id = ?
                               AND class_index IN ({','.join('?' for _ in allowed)})
                             ORDER BY start_seconds ASC
                             LIMIT 400
                            """,
                            [run["id"], *allowed],
                        ).fetchall()
                        for event in event_rows:
                            class_labels[int(event["class_index"])] = event["class_label"]
                            events.append(
                                {
                                    "class_index": event["class_index"],
                                    "label": event["class_label"],
                                    "start_seconds": event["start_seconds"],
                                    "end_seconds": event["end_seconds"],
                                    "model_score": event["model_score"],
                                }
                            )
                    for item in recording["top_classes"]:
                        class_labels[int(item["class_index"])] = item["label"]
                payload["analysis_run_id"] = run_id
                payload["waveform"] = waveform
                payload["events"] = events
            else:
                payload["analysis_run_id"] = None
                payload["waveform"] = []
                payload["events"] = []
            stops.append(payload)

    has_coordinates = any(
        stop.get("latitude") is not None and stop.get("longitude") is not None
        for stop in stops
    )
    return {
        "session_id": walk["id"],
        "title": walk["title"],
        "mission_key": walk["mission_key"],
        "mission_title": walk["mission_title"],
        "route_id": walk["route_id"],
        "route_name": walk["route_name"],
        "place_id": walk["place_id"],
        "place_name": walk["place_name"],
        "status": walk["status"],
        "started_at": walk["started_at"],
        "completed_at": walk["completed_at"],
        "progress": walk["progress"],
        "stops": stops,
        "classes": [
            {"class_index": index, "label": label}
            for index, label in sorted(class_labels.items(), key=lambda item: item[1].lower())
        ],
        "has_coordinates": has_coordinates,
        "note": (
            "Ordered route diagram from saved stops. "
            + (
                "Optional coordinates are shown only as saved stop metadata; no tiles or basemap are used."
                if has_coordinates
                else "No coordinates were recorded, so this is a schematic route, not a geographic map."
            )
        ),
    }


def _compare_groups(
    settings: Settings,
    session: sqlite3.Row,
    other_session_id: int | None,
    baseline_stop_ids: list[int] | None,
    recent_stop_ids: list[int] | None,
) -> tuple[list[int], list[int], int | None]:
    with connect(settings) as connection:
        if other_session_id is not None:
            other = connection.execute(
                "SELECT * FROM walk_sessions WHERE id = ?", (other_session_id,)
            ).fetchone()
            if not other:
                raise WalkNotFoundError("The comparison walk does not exist.")
            if int(other["place_id"]) != int(session["place_id"]):
                raise WalkError("Both walks must belong to the same place.")
            if session["route_id"] and other["route_id"] and int(session["route_id"]) != int(other["route_id"]):
                raise WalkError("Repeat walks should use the same saved route to be comparable.")
            baseline_rows = connection.execute(
                "SELECT recording_id FROM walk_stops WHERE session_id = ? "
                "AND recording_id IS NOT NULL ORDER BY stop_order",
                (other_session_id,),
            ).fetchall()
            recent_rows = connection.execute(
                "SELECT recording_id FROM walk_stops WHERE session_id = ? "
                "AND recording_id IS NOT NULL ORDER BY stop_order",
                (session["id"],),
            ).fetchall()
            return (
                [int(row["recording_id"]) for row in baseline_rows],
                [int(row["recording_id"]) for row in recent_rows],
                int(other_session_id),
            )

        if not baseline_stop_ids or not recent_stop_ids:
            raise WalkError("Select two stops with recordings to compare.")
        baseline_rows = connection.execute(
            f"SELECT recording_id FROM walk_stops WHERE session_id = ? AND id IN "
            f"({','.join('?' for _ in baseline_stop_ids)})",
            [session["id"], *baseline_stop_ids],
        ).fetchall()
        recent_rows = connection.execute(
            f"SELECT recording_id FROM walk_stops WHERE session_id = ? AND id IN "
            f"({','.join('?' for _ in recent_stop_ids)})",
            [session["id"], *recent_stop_ids],
        ).fetchall()
        baseline = [row["recording_id"] for row in baseline_rows if row["recording_id"]]
        recent = [row["recording_id"] for row in recent_rows if row["recording_id"]]
        if len(baseline) != len(set(baseline_stop_ids)) or len(recent) != len(
            set(recent_stop_ids)
        ):
            raise WalkError("Every selected stop must have a saved recording.")
        return [int(item) for item in baseline], [int(item) for item in recent], None


def compare_walk(
    settings: Settings,
    session_id: int,
    *,
    other_session_id: int | None = None,
    baseline_stop_ids: list[int] | None = None,
    recent_stop_ids: list[int] | None = None,
    threshold: float | None = None,
    fading_threshold_pp: float | None = None,
) -> dict[str, Any]:
    with connect(settings) as connection:
        session = connection.execute(
            "SELECT * FROM walk_sessions WHERE id = ?", (session_id,)
        ).fetchone()
        if not session:
            raise WalkNotFoundError("Walk not found.")
        baseline_ids, recent_ids, linked_other = _compare_groups(
            settings, session, other_session_id, baseline_stop_ids, recent_stop_ids
        )
        if not baseline_ids:
            raise WalkError("The baseline walk has no saved recordings to compare.")
        if not recent_ids:
            raise WalkError("This walk has no saved recordings to compare yet.")
        comparison_id = create_comparison(
            settings,
            {
                "place_id": session["place_id"],
                "baseline_recording_ids": baseline_ids,
                "recent_recording_ids": recent_ids,
                "threshold": threshold,
                "fading_threshold_pp": fading_threshold_pp,
            },
        )
        connection.execute(
            "UPDATE comparisons SET baseline_session_id = ?, recent_session_id = ? "
            "WHERE id = ?",
            (
                linked_other if linked_other is not None else session_id,
                session_id,
                comparison_id,
            ),
        )
        connection.commit()
    return get_comparison(settings, comparison_id)


def comparison_preview(
    settings: Settings, session_id: int, other_session_id: int | None = None
) -> dict[str, Any]:
    walk = get_walk(settings, session_id)
    if walk is None:
        raise WalkNotFoundError("Walk not found.")
    with connect(settings) as connection:
        if other_session_id is None:
            if walk["route_id"]:
                previous = connection.execute(
                    """
                    SELECT id FROM walk_sessions
                     WHERE route_id = ? AND id != ? AND status = 'completed'
                     ORDER BY completed_at DESC, id DESC LIMIT 1
                    """,
                    (walk["route_id"], session_id),
                ).fetchone()
                other_session_id = int(previous["id"]) if previous else None
        other = None
        if other_session_id is not None:
            other = connection.execute(
                "SELECT * FROM walk_sessions WHERE id = ?", (other_session_id,)
            ).fetchone()
            if not other:
                raise WalkNotFoundError("The comparison walk does not exist.")
        other_stops = (
            connection.execute(
                "SELECT * FROM walk_stops WHERE session_id = ? ORDER BY stop_order",
                (other_session_id,),
            ).fetchall()
            if other_session_id
            else []
        )

    warnings: list[str] = []
    pairs: list[dict[str, Any]] = []
    for index, stop in enumerate(walk["stops"]):
        prior = other_stops[index] if index < len(other_stops) else None
        prior_recording = None
        if prior and prior["recording_id"]:
            with connect(settings) as connection:
                row = connection.execute(
                    "SELECT * FROM recordings WHERE id = ?", (prior["recording_id"],)
                ).fetchone()
                if row:
                    prior_recording = _recording_summary(connection, row)
        current = stop["recording"]
        status = "missing"
        if prior_recording and current:
            if (
                prior_recording["analysis_status"] == "completed"
                and current["analysis_status"] == "completed"
            ):
                status = "comparable"
            elif "failed" in {
                prior_recording["analysis_status"],
                current["analysis_status"],
            }:
                status = "analysis_failed"
            else:
                status = "analysis_pending"
        elif current or prior_recording:
            status = "insufficient_evidence"
        pairs.append(
            {
                "stop_order": index,
                "stop_name": stop["name"],
                "previous_stop_name": prior["name"] if prior else None,
                "baseline_recording": prior_recording,
                "recent_recording": current,
                "status": status,
            }
        )

    comparable = sum(1 for pair in pairs if pair["status"] == "comparable")
    if comparable < 2:
        warnings.append(
            "Fewer than two pairs of stops have finished sound results. This comparison is a "
            "rough look and may not be ready yet."
        )
    if other is not None and not walk["route_id"]:
        warnings.append("These walks do not share a saved route, so stops are paired by their order.")
    if other is not None:
        baseline_date = _as_utc(other["started_at"])
        recent_date = _as_utc(walk["started_at"])
        hour_gap = abs((recent_date - baseline_date).total_seconds()) % 86400
        if 4 * 3600 < hour_gap < 20 * 3600:
            warnings.append(
                "The visits may have been recorded at different times of day. Time, weather and "
                "activity can change both the place and what the sound reader finds."
            )
        if (recent_date - baseline_date).days < 1:
            warnings.append(
                "These two walks were started less than a day apart. A repeat visit is most useful "
                "when the place has had time to change."
            )
    failed = [pair for pair in pairs if pair["status"] == "analysis_failed"]
    if failed:
        warnings.append(
            f"{len(failed)} stop pair(s) include a recording where the sound search did not "
            "finish. You can try those again before comparing."
        )
    return {
        "session_id": walk["id"],
        "other_session_id": other_session_id,
        "other_session_title": other["title"] if other else None,
        "other_started_at": other["started_at"] if other else None,
        "pairs": pairs,
        "comparable_pairs": comparable,
        "warnings": warnings,
        "newest_is_this_walk": True,
    }


def walk_report(settings: Settings, session_id: int) -> str:
    walk = get_walk(settings, session_id)
    if walk is None:
        raise WalkNotFoundError("Walk not found.")
    lines = [
        f"# {walk['title']}",
        "",
        f"**Mission:** {walk['mission_title']}  ",
        f"**Place:** {walk['place_name']}  ",
        f"**Route:** {walk['route_name'] or 'Ad hoc route'}  ",
        f"**Started:** {walk['started_at']}  ",
        f"**Status:** {WALK_STATUS_LABELS.get(walk['status'], walk['status'])}  ",
        f"**Stops:** {walk['progress']['total_stops']} · "
        f"recorded {walk['progress']['recorded_stops']} · "
        f"analyzed {walk['progress']['analyzed_stops']} · "
        f"did not finish {walk['progress']['failed_analysis_stops']}",
        "",
        "## Stops",
        "",
    ]
    for stop in walk["stops"]:
        lines.append(f"### {stop['stop_order'] + 1}. {stop['name']}")
        lines.append("")
        lines.append(f"- Stop state: {stop['status_label']}")
        if stop["observation"]:
            lines.append(f"- Your observation: {stop['observation']}")
        recording = stop["recording"]
        if recording:
            lines.append(
                f"- Recording: {recording['title']} ({recording['duration_seconds']:.1f} s, "
                f"{recording['recorded_at']})"
            )
            lines.append(
                f"- Sound search: {ANALYSIS_STATUS_LABELS.get(recording['analysis_status'], recording['analysis_status'])}"
            )
            if recording["analysis_error"]:
                lines.append(f"- Sound search note: {recording['analysis_error']}")
            if recording["top_classes"]:
                labels = ", ".join(
                    f"{item['label']} ({item['detection_rate'] * 100:.1f}% of moments)"
                    for item in recording["top_classes"]
                )
                lines.append(f"- Sounds found: {labels}")
        else:
            lines.append("- No recording was saved.")
        lines.append("")
    lines.extend(
        [
            "## Limits",
            "",
            "The sound reader names broad sound types, not species or sources. A match level is "
            "not a probability. Differences can come from microphone position, volume, weather, "
            "time of day, recording length, or real change. This report does not explain why.",
            "",
            f"Generated {'on the Hush Atlas server' if settings.hosted else 'locally'} by Hush Atlas · walk #{walk['id']}",
        ]
    )
    if walk["notes"]:
        lines.insert(7, f"**Notes:** {walk['notes']}  ")
    return "\n".join(lines)
