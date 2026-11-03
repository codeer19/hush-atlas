"""Typed API contracts."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

AnalysisStatus = Literal["not_analyzed", "queued", "running", "completed", "failed"]
RecordingSource = Literal["upload", "browser_recording"]
WalkStatus = Literal["active", "paused", "completed"]
WalkStopStatus = Literal[
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
]
Classification = Literal[
    "detected_more", "detected_less", "similar", "newly_detected", "not_detected"
]
ReflectionSource = Literal["gemma", "deterministic-fallback"]


def _aware(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


class PlaceCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=4000)

    @field_validator("name")
    @classmethod
    def _name_not_blank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Give this place a name.")
        return value

    @field_validator("description")
    @classmethod
    def _trim_description(cls, value: str) -> str:
        return value.strip()


class PlaceUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=4000)

    @field_validator("name")
    @classmethod
    def _name_not_blank(cls, value: str | None) -> str | None:
        if value is None:
            return value
        value = value.strip()
        if not value:
            raise ValueError("Give this place a name.")
        return value

    @field_validator("description")
    @classmethod
    def _trim_description(cls, value: str | None) -> str | None:
        return value.strip() if value is not None else value


class TopClassOut(BaseModel):
    class_index: int
    label: str
    detection_rate: float
    peak_score: float


class PlaceOut(BaseModel):
    id: int
    name: str
    description: str
    is_demo: bool
    created_at: datetime
    updated_at: datetime
    recording_count: int = 0
    analyzed_count: int = 0
    last_recorded_at: datetime | None = None


class PlaceDetailOut(PlaceOut):
    recordings: list["RecordingOut"] = Field(default_factory=list)


class RecordingUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    notes: str | None = Field(default=None, max_length=8000)
    recorded_at: datetime | None = None

    @field_validator("title")
    @classmethod
    def _title_not_blank(cls, value: str | None) -> str | None:
        if value is None:
            return value
        value = value.strip()
        if not value:
            raise ValueError("Give this recording a title.")
        return value

    @field_validator("notes")
    @classmethod
    def _trim_notes(cls, value: str | None) -> str | None:
        return value.strip() if value is not None else value

    @field_validator("recorded_at")
    @classmethod
    def _recorded_aware(cls, value: datetime | None) -> datetime | None:
        return _aware(value) if value is not None else None


class RecordingOut(BaseModel):
    id: int
    place_id: int
    place_name: str = ""
    title: str
    notes: str
    recorded_at: datetime
    created_at: datetime
    updated_at: datetime
    duration_seconds: float
    original_filename: str
    audio_format: str
    sample_rate: int
    channels: int
    source: RecordingSource
    analysis_status: AnalysisStatus
    analysis_error: str | None = None
    top_classes: list[TopClassOut] = Field(default_factory=list)


class WaveformOut(BaseModel):
    recording_id: int
    duration_seconds: float
    peaks: list[float]


class RecordingDetailOut(RecordingOut):
    waveform: WaveformOut
    audio_url: str


class AnalysisEventOut(BaseModel):
    start_seconds: float
    end_seconds: float
    model_score: float
    mean_score: float
    window_count: int


class AnalysisClassOut(BaseModel):
    class_index: int
    label: str
    detection_rate: float
    detected_windows: int
    window_count: int
    peak_score: float
    mean_score: float
    events: list[AnalysisEventOut] = Field(default_factory=list)


class AnalysisRunOut(BaseModel):
    id: int
    model_name: str
    model_version: str | None
    threshold: float
    window_count: int
    window_hop_seconds: float
    duration_seconds: float
    started_at: datetime
    completed_at: datetime | None
    status: Literal["running", "completed", "failed"]
    error_message: str | None = None
    classes: list[AnalysisClassOut] = Field(default_factory=list)


class AnalysisResponse(BaseModel):
    recording_id: int
    status: AnalysisStatus
    error: str | None = None
    analysis: AnalysisRunOut | None = None


class MapEventOut(BaseModel):
    class_index: int
    label: str
    start_seconds: float
    end_seconds: float
    model_score: float


class MapRecordingOut(BaseModel):
    recording_id: int
    title: str
    recorded_at: datetime
    duration_seconds: float
    analysis_status: AnalysisStatus
    analysis_run_id: int | None = None
    top_classes: list[TopClassOut] = Field(default_factory=list)
    events: list[MapEventOut] = Field(default_factory=list)


class MapClassOut(BaseModel):
    class_index: int
    label: str


class AcousticMapOut(BaseModel):
    place_id: int
    place_name: str
    is_demo: bool
    recordings: list[MapRecordingOut]
    classes: list[MapClassOut]
    note: str


class AnalysisJobOut(BaseModel):
    recording_id: int
    status: AnalysisStatus
    run_id: int | None = None
    message: str


class AnalysisRequest(BaseModel):
    threshold: float | None = Field(default=None, ge=0.01, le=0.99)
    force: bool = False


class ComparisonCreate(BaseModel):
    place_id: int
    baseline_recording_ids: list[int] = Field(min_length=1, max_length=200)
    recent_recording_ids: list[int] = Field(min_length=1, max_length=200)
    threshold: float | None = Field(default=None, ge=0.01, le=0.99)
    fading_threshold_pp: float | None = Field(default=None, ge=1.0, le=100.0)

    @field_validator("baseline_recording_ids", "recent_recording_ids")
    @classmethod
    def _unique_ids(cls, value: list[int]) -> list[int]:
        return list(dict.fromkeys(value))


class ComparisonGroupRecordingOut(BaseModel):
    recording_id: int
    title: str
    recorded_at: datetime
    duration_seconds: float
    analysis_run_id: int
    sample_rate: int
    channels: int
    source: str
    audio_format: str


class ComparisonRecordingInGroup(BaseModel):
    recording_id: int
    title: str
    recorded_at: datetime
    duration_seconds: float
    detection_rate: float
    detected_windows: int
    window_count: int
    peak_score: float
    peak_window_start: float | None = None
    peak_window_end: float | None = None


class ComparisonGroupOut(BaseModel):
    recording_ids: list[int]
    recordings: list[ComparisonGroupRecordingOut]
    recording_count: int
    window_count: int
    date_start: datetime | None = None
    date_end: datetime | None = None


class ComparisonResultOut(BaseModel):
    class_index: int
    label: str
    baseline_rate: float
    recent_rate: float
    difference_pp: float
    baseline_detected_windows: int
    recent_detected_windows: int
    classification: Classification
    fading: bool
    notable: bool
    baseline_recording_rates: list[ComparisonRecordingInGroup]
    recent_recording_rates: list[ComparisonRecordingInGroup]


class ComparisonSummaryOut(BaseModel):
    class_count: int
    fading_count: int
    newly_detected_count: int
    detected_more_count: int
    detected_less_count: int
    similar_count: int


class ComparisonOut(BaseModel):
    id: int
    place_id: int
    place_name: str
    baseline_session_id: int | None = None
    recent_session_id: int | None = None
    stop_context: list[StopContextOut] = Field(default_factory=list)
    threshold: float
    fading_threshold_pp: float
    change_threshold_pp: float
    baseline: ComparisonGroupOut
    recent: ComparisonGroupOut
    warnings: list[str]
    reliability: Literal["adequate", "limited"]
    summary: ComparisonSummaryOut
    results: list[ComparisonResultOut]
    model_name: str
    model_version: str | None
    input_hash: str
    created_at: datetime


class ComparisonListItem(BaseModel):
    id: int
    place_id: int
    place_name: str
    created_at: datetime
    threshold: float
    baseline_count: int
    recent_count: int
    fading_count: int
    notable_count: int


class ReflectionOut(BaseModel):
    comparison_id: int
    class_index: int
    label: str
    source: ReflectionSource
    model_name: str | None
    text: str
    cached: bool
    gemma_available: bool
    warning: str | None = None
    created_at: datetime | None = None


class ReflectionRequest(BaseModel):
    class_index: int = Field(ge=0, le=520)
    regenerate: bool = False


class GemmaModelOut(BaseModel):
    name: str
    size_bytes: int | None = None
    modified_at: str | None = None


class GemmaStatusOut(BaseModel):
    reachable: bool
    endpoint: str
    selected_model: str | None
    compatible_models: list[GemmaModelOut]
    installed_models: list[str]
    detail: str


class GemmaSelectRequest(BaseModel):
    model: str = Field(min_length=1, max_length=200)


class YamnetStatusOut(BaseModel):
    status: Literal["ready", "not_installed", "error"]
    label: str
    detail: str
    weights_present: bool
    class_map_present: bool
    dependencies_present: bool
    loaded: bool
    model_version: str | None = None
    class_count: int | None = None
    weights_sha256: str | None = None
    class_map_sha256: str | None = None


class ModelsStatusOut(BaseModel):
    audio: YamnetStatusOut
    gemma: GemmaStatusOut
    offline_ready: bool
    offline_detail: str


class HealthOut(BaseModel):
    status: Literal["ok", "degraded"]
    app: str
    version: str
    time: datetime
    database: bool
    local_only: bool
    audio_model_assets: bool


class LatestRecordingOut(BaseModel):
    id: int
    place_id: int
    place_name: str
    title: str
    recorded_at: datetime
    analysis_status: AnalysisStatus


class NotableChangeOut(BaseModel):
    comparison_id: int
    place_id: int
    place_name: str
    comparison_created_at: datetime
    class_index: int
    label: str
    baseline_rate: float
    recent_rate: float
    difference_pp: float
    classification: Classification
    fading: bool


class OverviewOut(BaseModel):
    place_count: int
    recording_count: int
    analyzed_count: int
    total_duration_seconds: float
    latest_recording: LatestRecordingOut | None
    notable_changes: list[NotableChangeOut]
    demo_available: bool


class DemoRecordingOut(BaseModel):
    recording_id: int
    title: str
    recorded_at: datetime
    status: AnalysisStatus


class DemoStatusOut(BaseModel):
    status: Literal["absent", "preparing", "ready", "failed"]
    detail: str
    place_id: int | None = None
    place_name: str | None = None
    comparison_id: int | None = None
    walk_id: int | None = None
    recordings: list[DemoRecordingOut] = Field(default_factory=list)


class RouteStopCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    notes: str = Field(default="", max_length=2000)
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)

    @field_validator("name")
    @classmethod
    def _stop_name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Give this stopping point a name.")
        return value

    @field_validator("notes")
    @classmethod
    def _stop_notes(cls, value: str) -> str:
        return value.strip()


class WalkStopCreate(RouteStopCreate):
    pass


class WalkCreate(BaseModel):
    mission_key: str = Field(min_length=1, max_length=80)
    place_id: int | None = Field(default=None, ge=1)
    route_id: int | None = Field(default=None, ge=1)
    title: str | None = Field(default=None, max_length=200)
    notes: str = Field(default="", max_length=4000)
    route_name: str | None = Field(default=None, max_length=160)
    route_description: str = Field(default="", max_length=4000)
    route_notes: str = Field(default="", max_length=4000)
    recording_duration_seconds: float = Field(default=30.0, ge=5.0, le=180.0)
    stops: list[WalkStopCreate] = Field(default_factory=list, max_length=12)

    @field_validator("title", "route_name")
    @classmethod
    def _trim_optional(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        return value or None


class WalkUpdate(BaseModel):
    status: WalkStatus | None = None
    notes: str | None = Field(default=None, max_length=4000)


class WalkStopUpdate(BaseModel):
    observation: str | None = Field(default=None, max_length=2000)
    status: WalkStopStatus | None = None


class WalkRecordingOut(BaseModel):
    id: int
    place_id: int
    place_name: str = ""
    title: str
    recorded_at: datetime
    duration_seconds: float
    audio_format: str
    sample_rate: int
    channels: int
    source: str
    analysis_status: AnalysisStatus
    analysis_error: str | None = None
    audio_url: str
    top_classes: list[TopClassOut] = Field(default_factory=list)


class WalkStopOut(BaseModel):
    id: int
    session_id: int
    route_stop_id: int | None = None
    stop_order: int
    name: str
    latitude: float | None = None
    longitude: float | None = None
    observation: str
    status: WalkStopStatus
    status_label: str
    interrupted_recording: bool = False
    recording: WalkRecordingOut | None = None
    created_at: datetime
    updated_at: datetime


class WalkProgressOut(BaseModel):
    total_stops: int
    recorded_stops: int
    analyzed_stops: int
    failed_analysis_stops: int
    reviewed_stops: int
    remaining_stops: int


class PreviousVisitOut(BaseModel):
    id: int
    title: str
    status: WalkStatus
    started_at: datetime
    completed_at: datetime | None = None
    stops: list[WalkStopOut] = Field(default_factory=list)


class WalkOut(BaseModel):
    id: int
    mission_key: str
    mission_title: str
    mission_short_description: str = ""
    mission_comparison_mode: str = ""
    route_id: int | None = None
    route_name: str | None = None
    recording_duration_seconds: float = 30.0
    place_id: int
    place_name: str
    place_description: str = ""
    is_demo: bool = False
    title: str
    status: WalkStatus
    notes: str
    started_at: datetime
    paused_at: datetime | None = None
    completed_at: datetime | None = None
    updated_at: datetime
    progress: WalkProgressOut
    stops: list[WalkStopOut]
    previous_visit: PreviousVisitOut | None = None


class WalkSummaryOut(BaseModel):
    id: int
    mission_key: str
    mission_title: str
    title: str
    status: WalkStatus
    place_id: int
    place_name: str
    is_demo: bool = False
    route_id: int | None = None
    route_name: str | None = None
    started_at: datetime
    completed_at: datetime | None = None
    stop_count: int
    recorded_count: int
    analyzed_count: int


class RouteStopOut(BaseModel):
    id: int
    stop_order: int
    name: str
    notes: str
    latitude: float | None = None
    longitude: float | None = None


class RouteSessionSummaryOut(BaseModel):
    id: int
    title: str
    status: WalkStatus
    started_at: datetime
    completed_at: datetime | None = None


class RouteSummaryOut(BaseModel):
    id: int
    place_id: int
    place_name: str
    name: str
    description: str
    notes: str
    recording_duration_seconds: float
    stop_count: int
    completed_visit_count: int
    last_completed_at: datetime | None = None
    created_at: datetime
    updated_at: datetime


class RouteOut(RouteSummaryOut):
    place_description: str = ""
    is_demo: bool = False
    stops: list[RouteStopOut] = Field(default_factory=list)
    sessions: list[RouteSessionSummaryOut] = Field(default_factory=list)
    previous_session: RouteSessionSummaryOut | None = None


class WalkMapStopOut(BaseModel):
    id: int
    session_id: int
    stop_order: int
    name: str
    latitude: float | None = None
    longitude: float | None = None
    observation: str
    status: WalkStopStatus
    status_label: str
    interrupted_recording: bool = False
    recording: WalkRecordingOut | None = None
    analysis_run_id: int | None = None
    waveform: list[float] = Field(default_factory=list)
    events: list[MapEventOut] = Field(default_factory=list)


class WalkMapOut(BaseModel):
    session_id: int
    title: str
    mission_key: str
    mission_title: str
    route_id: int | None = None
    route_name: str | None = None
    place_id: int
    place_name: str
    status: WalkStatus
    started_at: datetime
    completed_at: datetime | None = None
    progress: WalkProgressOut
    stops: list[WalkMapStopOut]
    classes: list[MapClassOut]
    has_coordinates: bool
    note: str


class WalkComparisonRequest(BaseModel):
    other_session_id: int | None = Field(default=None, ge=1)
    baseline_stop_ids: list[int] = Field(default_factory=list, max_length=12)
    recent_stop_ids: list[int] = Field(default_factory=list, max_length=12)
    threshold: float | None = Field(default=None, ge=0.01, le=0.99)
    fading_threshold_pp: float | None = Field(default=None, ge=1.0, le=100.0)


class ComparableStopOut(BaseModel):
    stop_order: int
    stop_name: str
    previous_stop_name: str | None = None
    baseline_recording: WalkRecordingOut | None = None
    recent_recording: WalkRecordingOut | None = None
    status: Literal[
        "comparable",
        "insufficient_evidence",
        "analysis_pending",
        "analysis_failed",
        "missing",
    ]


class ComparabilityPreviewOut(BaseModel):
    session_id: int
    other_session_id: int | None = None
    other_session_title: str | None = None
    other_started_at: datetime | None = None
    pairs: list[ComparableStopOut]
    comparable_pairs: int
    warnings: list[str]
    newest_is_this_walk: bool


class StopContextOut(BaseModel):
    recording_id: int | None = None
    stop_id: int
    stop_name: str
    stop_order: int
    observation: str
    session_id: int
    session_title: str
    session_status: WalkStatus
    route_id: int | None = None
    route_name: str | None = None


class FingerprintSummaryOut(BaseModel):
    recording_id: int
    title: str
    place_name: str
    stop_name: str | None = None
    recorded_at: datetime
    duration_seconds: float
    model_name: str | None = None
    model_version: str | None = None
    window_count: int
    threshold: float | None = None
    event_count: int
    class_count: int
    peak_score: float
    config: dict[str, Any] = Field(default_factory=dict)
    audio_url: str
    waveform_peaks: list[float] = Field(default_factory=list)


class FingerprintOut(BaseModel):
    recording: dict[str, Any]
    stop_context: StopContextOut | None = None
    analysis: dict[str, Any]
    fingerprint: FingerprintSummaryOut
    warnings: list[str]


class StopComparisonOut(BaseModel):
    comparison: ComparisonOut
    result: ComparisonResultOut
    baseline_recordings: list[dict[str, Any]]
    recent_recordings: list[dict[str, Any]]
    evidence_notes: list[str]


class DeleteOut(BaseModel):
    deleted: bool
    id: int
    warnings: list[str] = Field(default_factory=list)


class MessageOut(BaseModel):
    message: str


class ApiError(BaseModel):
    detail: str


PlaceDetailOut.model_rebuild()
ComparisonOut.model_rebuild()
StopComparisonOut.model_rebuild()
