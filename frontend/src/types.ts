export type AnalysisStatus =
  | "not_analyzed"
  | "queued"
  | "running"
  | "completed"
  | "failed";

export type RecordingSource = "upload" | "browser_recording";

export type Classification =
  | "detected_more"
  | "detected_less"
  | "similar"
  | "newly_detected"
  | "not_detected";

export type ReflectionSource = "gemma" | "deterministic-fallback" | "on-device";

export interface TopClass {
  class_index: number;
  label: string;
  detection_rate: number;
  peak_score: number;
}

export interface Place {
  id: number;
  name: string;
  description: string;
  is_demo: boolean;
  created_at: string;
  updated_at: string;
  recording_count: number;
  analyzed_count: number;
  last_recorded_at: string | null;
}

export interface Recording {
  id: number;
  place_id: number;
  place_name: string;
  title: string;
  notes: string;
  recorded_at: string;
  created_at: string;
  updated_at: string;
  duration_seconds: number;
  original_filename: string;
  audio_format: string;
  sample_rate: number;
  channels: number;
  source: RecordingSource;
  analysis_status: AnalysisStatus;
  analysis_error: string | null;
  top_classes: TopClass[];
}

export interface Waveform {
  recording_id: number;
  duration_seconds: number;
  peaks: number[];
}

export interface RecordingDetail extends Recording {
  waveform: Waveform;
  audio_url: string;
}

export interface PlaceDetail extends Place {
  recordings: Recording[];
}

export interface AnalysisEvent {
  start_seconds: number;
  end_seconds: number;
  model_score: number;
  mean_score: number;
  window_count: number;
}

export interface AnalysisClass {
  class_index: number;
  label: string;
  detection_rate: number;
  detected_windows: number;
  window_count: number;
  peak_score: number;
  mean_score: number;
  events: AnalysisEvent[];
}

export interface AnalysisRun {
  id: number;
  model_name: string;
  model_version: string | null;
  threshold: number;
  window_count: number;
  window_hop_seconds: number;
  duration_seconds: number;
  started_at: string;
  completed_at: string | null;
  status: "running" | "completed" | "failed";
  error_message: string | null;
  classes: AnalysisClass[];
}

export interface AnalysisResponse {
  recording_id: number;
  status: AnalysisStatus;
  error: string | null;
  analysis: AnalysisRun | null;
}

export interface AnalysisJob {
  recording_id: number;
  status: AnalysisStatus;
  run_id: number | null;
  message: string;
}

export interface MapEvent {
  class_index: number;
  label: string;
  start_seconds: number;
  end_seconds: number;
  model_score: number;
}

export interface MapRecording {
  recording_id: number;
  title: string;
  recorded_at: string;
  duration_seconds: number;
  analysis_status: AnalysisStatus;
  analysis_run_id: number | null;
  top_classes: TopClass[];
  events: MapEvent[];
}

export interface MapClass {
  class_index: number;
  label: string;
}

export interface AcousticMap {
  place_id: number;
  place_name: string;
  is_demo: boolean;
  recordings: MapRecording[];
  classes: MapClass[];
  note: string;
}

export interface ComparisonRecording {
  recording_id: number;
  title: string;
  recorded_at: string;
  duration_seconds: number;
  analysis_run_id: number;
  sample_rate: number;
  channels: number;
  source: string;
  audio_format: string;
}

export interface ComparisonRecordingRate {
  recording_id: number;
  title: string;
  recorded_at: string;
  duration_seconds: number;
  detection_rate: number;
  detected_windows: number;
  window_count: number;
  peak_score: number;
  peak_window_start: number | null;
  peak_window_end: number | null;
}

export interface ComparisonGroup {
  recording_ids: number[];
  recordings: ComparisonRecording[];
  recording_count: number;
  window_count: number;
  date_start: string | null;
  date_end: string | null;
}

export interface ComparisonResult {
  class_index: number;
  label: string;
  baseline_rate: number;
  recent_rate: number;
  difference_pp: number;
  baseline_detected_windows: number;
  recent_detected_windows: number;
  classification: Classification;
  fading: boolean;
  notable: boolean;
  baseline_recording_rates: ComparisonRecordingRate[];
  recent_recording_rates: ComparisonRecordingRate[];
}

export interface ComparisonSummary {
  class_count: number;
  fading_count: number;
  newly_detected_count: number;
  detected_more_count: number;
  detected_less_count: number;
  similar_count: number;
}

export interface StopContext {
  recording_id: number | null;
  stop_id: number;
  stop_name: string;
  stop_order: number;
  observation: string;
  session_id: number;
  session_title: string;
  session_status: WalkStatus;
  route_id: number | null;
  route_name: string | null;
}

export interface Comparison {
  id: number;
  place_id: number;
  place_name: string;
  baseline_session_id: number | null;
  recent_session_id: number | null;
  stop_context: StopContext[];
  threshold: number;
  fading_threshold_pp: number;
  change_threshold_pp: number;
  baseline: ComparisonGroup;
  recent: ComparisonGroup;
  warnings: string[];
  reliability: "adequate" | "limited";
  summary: ComparisonSummary;
  results: ComparisonResult[];
  model_name: string;
  model_version: string | null;
  input_hash: string;
  created_at: string;
}

export interface ComparisonListItem {
  id: number;
  place_id: number;
  place_name: string;
  created_at: string;
  threshold: number;
  baseline_count: number;
  recent_count: number;
  fading_count: number;
  notable_count: number;
}

export interface Reflection {
  comparison_id: number;
  class_index: number;
  label: string;
  source: ReflectionSource;
  model_name: string | null;
  text: string;
  cached: boolean;
  gemma_available: boolean;
  warning: string | null;
  created_at: string | null;
}

export interface GemmaModel {
  name: string;
  size_bytes: number | null;
  modified_at: string | null;
}

export interface GemmaStatus {
  reachable: boolean;
  endpoint: string;
  selected_model: string | null;
  compatible_models: GemmaModel[];
  installed_models: string[];
  detail: string;
}

export interface YamnetStatus {
  status: "ready" | "not_installed" | "error";
  label: string;
  detail: string;
  weights_present: boolean;
  class_map_present: boolean;
  dependencies_present: boolean;
  loaded: boolean;
  model_version: string | null;
  class_count: number | null;
  weights_sha256: string | null;
  class_map_sha256: string | null;
}

export interface ModelsStatus {
  audio: YamnetStatus;
  gemma: GemmaStatus;
  offline_ready: boolean;
  offline_detail: string;
}

export interface LatestRecording {
  id: number;
  place_id: number;
  place_name: string;
  title: string;
  recorded_at: string;
  analysis_status: AnalysisStatus;
}

export interface NotableChange {
  comparison_id: number;
  place_id: number;
  place_name: string;
  comparison_created_at: string;
  class_index: number;
  label: string;
  baseline_rate: number;
  recent_rate: number;
  difference_pp: number;
  classification: Classification;
  fading: boolean;
}

export interface Overview {
  place_count: number;
  recording_count: number;
  analyzed_count: number;
  total_duration_seconds: number;
  latest_recording: LatestRecording | null;
  notable_changes: NotableChange[];
  demo_available: boolean;
}

export interface DemoRecording {
  recording_id: number;
  title: string;
  recorded_at: string;
  status: AnalysisStatus;
}

export interface DemoStatus {
  status: "absent" | "preparing" | "ready" | "failed";
  detail: string;
  place_id: number | null;
  place_name: string | null;
  comparison_id: number | null;
  walk_id: number | null;
  recordings: DemoRecording[];
}

export interface DeleteResponse {
  deleted: boolean;
  id: number;
  warnings: string[];
}

export interface MessageResponse {
  message: string;
}

export interface Health {
  status: "ok" | "degraded";
  app: string;
  version: string;
  time: string;
  database: boolean;
  local_only: boolean;
  audio_model_assets: boolean;
}

export type WalkStatus = "active" | "paused" | "completed";

export type WalkStopStatus =
  | "ready_to_listen"
  | "listening"
  | "ready_to_record"
  | "recording"
  | "recorded"
  | "analysis_pending"
  | "analyzed"
  | "analysis_failed"
  | "reviewed"
  | "completed";

export type MissionComparisonMode =
  | "within-session"
  | "repeat-visit"
  | "between-stops";

export interface Mission {
  key: string;
  title: string;
  short_description: string;
  purpose: string;
  estimated_duration_minutes: number;
  duration_is_estimate: boolean;
  suggested_stops: number;
  minimum_stops: number;
  maximum_stops: number;
  what_you_will_do: string[];
  comparison_mode: MissionComparisonMode;
  default_stop_names: string[];
}

export interface WalkRecording {
  id: number;
  place_id: number;
  place_name: string;
  title: string;
  recorded_at: string;
  duration_seconds: number;
  audio_format: string;
  sample_rate: number;
  channels: number;
  source: RecordingSource;
  analysis_status: AnalysisStatus;
  analysis_error: string | null;
  audio_url: string;
  top_classes: TopClass[];
}

export interface WalkStop {
  id: number;
  session_id: number;
  route_stop_id: number | null;
  stop_order: number;
  name: string;
  latitude: number | null;
  longitude: number | null;
  observation: string;
  status: WalkStopStatus;
  status_label: string;
  interrupted_recording: boolean;
  recording: WalkRecording | null;
  created_at: string;
  updated_at: string;
}

export interface WalkProgress {
  total_stops: number;
  recorded_stops: number;
  analyzed_stops: number;
  failed_analysis_stops: number;
  reviewed_stops: number;
  remaining_stops: number;
}

export interface PreviousVisit {
  id: number;
  title: string;
  status: WalkStatus;
  started_at: string;
  completed_at: string | null;
  stops: WalkStop[];
}

export interface Walk {
  id: number;
  mission_key: string;
  mission_title: string;
  mission_short_description: string;
  mission_comparison_mode: MissionComparisonMode | "";
  route_id: number | null;
  route_name: string | null;
  recording_duration_seconds: number;
  place_id: number;
  place_name: string;
  place_description: string;
  is_demo: boolean;
  title: string;
  status: WalkStatus;
  notes: string;
  started_at: string;
  paused_at: string | null;
  completed_at: string | null;
  updated_at: string;
  progress: WalkProgress;
  stops: WalkStop[];
  previous_visit: PreviousVisit | null;
}

export interface WalkSummary {
  id: number;
  mission_key: string;
  mission_title: string;
  title: string;
  status: WalkStatus;
  place_id: number;
  place_name: string;
  is_demo: boolean;
  route_id: number | null;
  route_name: string | null;
  started_at: string;
  completed_at: string | null;
  stop_count: number;
  recorded_count: number;
  analyzed_count: number;
}

export interface RouteStop {
  id: number;
  stop_order: number;
  name: string;
  notes: string;
  latitude: number | null;
  longitude: number | null;
}

export interface RouteSessionSummary {
  id: number;
  title: string;
  status: WalkStatus;
  started_at: string;
  completed_at: string | null;
}

export interface RouteSummary {
  id: number;
  place_id: number;
  place_name: string;
  name: string;
  description: string;
  notes: string;
  recording_duration_seconds: number;
  stop_count: number;
  completed_visit_count: number;
  last_completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Route extends RouteSummary {
  place_description: string;
  is_demo: boolean;
  stops: RouteStop[];
  sessions: RouteSessionSummary[];
  previous_session: RouteSessionSummary | null;
}

export interface WalkMapStop extends WalkStop {
  analysis_run_id: number | null;
  waveform: number[];
  events: MapEvent[];
}

export interface WalkMap {
  session_id: number;
  title: string;
  mission_key: string;
  mission_title: string;
  route_id: number | null;
  route_name: string | null;
  place_id: number;
  place_name: string;
  status: WalkStatus;
  started_at: string;
  completed_at: string | null;
  progress: WalkProgress;
  stops: WalkMapStop[];
  classes: MapClass[];
  has_coordinates: boolean;
  note: string;
}

export interface ComparableStop {
  stop_order: number;
  stop_name: string;
  previous_stop_name: string | null;
  baseline_recording: WalkRecording | null;
  recent_recording: WalkRecording | null;
  status:
    | "comparable"
    | "insufficient_evidence"
    | "analysis_pending"
    | "analysis_failed"
    | "missing";
}

export interface ComparabilityPreview {
  session_id: number;
  other_session_id: number | null;
  other_session_title: string | null;
  other_started_at: string | null;
  pairs: ComparableStop[];
  comparable_pairs: number;
  warnings: string[];
  newest_is_this_walk: boolean;
}

export interface FingerprintSummary {
  recording_id: number;
  title: string;
  place_name: string;
  stop_name: string | null;
  recorded_at: string;
  duration_seconds: number;
  model_name: string | null;
  model_version: string | null;
  window_count: number;
  threshold: number | null;
  event_count: number;
  class_count: number;
  peak_score: number;
  config: Record<string, unknown>;
  audio_url: string;
  waveform_peaks: number[];
}

export interface Fingerprint {
  recording: RecordingDetail;
  stop_context: StopContext | null;
  analysis: AnalysisResponse;
  fingerprint: FingerprintSummary;
  warnings: string[];
}

export interface EvidenceRecording {
  recording: {
    id: number;
    title: string;
    recorded_at: string;
    duration_seconds: number;
    analysis_status: AnalysisStatus;
    audio_url: string;
    waveform_peaks: number[];
    top_classes: TopClass[];
    class_events?: Array<{
      start_seconds: number;
      end_seconds: number;
      model_score: number;
    }>;
  };
  stop_context: StopContext | null;
}

export interface ComparisonEvidence {
  comparison: Comparison;
  result: ComparisonResult;
  baseline_recordings: EvidenceRecording[];
  recent_recordings: EvidenceRecording[];
  evidence_notes: string[];
}
