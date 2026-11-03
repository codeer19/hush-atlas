import { ApiError } from "./api";
import type {
  AnalysisStatus,
  Classification,
  Comparison,
  ComparisonGroup,
  ComparisonResult,
  Recording,
} from "./types";

export const DEFAULT_DETECTION_THRESHOLD = 0.2;
export const DEFAULT_FADING_THRESHOLD_PP = 10;
export const MAX_RECORDING_SECONDS = 180;

export function cx(
  ...values: Array<string | false | null | undefined>
): string {
  return values.filter(Boolean).join(" ");
}

export function pluralize(
  count: number,
  singular: string,
  plural = `${singular}s`,
): string {
  return count === 1 ? singular : plural;
}

export function formatCount(value: number): string {
  return new Intl.NumberFormat("en-GB").format(value);
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return "0:00";
  }
  const whole = Math.round(seconds);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const remainder = whole % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
  }
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

export function formatDurationLong(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return "0 sec";
  }
  const whole = Math.round(seconds);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const remainder = whole % 60;
  if (hours > 0) {
    const parts = [`${hours} hr`];
    if (minutes) {
      parts.push(`${minutes} min`);
    }
    return parts.join(" ");
  }
  if (minutes > 0) {
    return remainder
      ? `${minutes} min ${remainder} sec`
      : `${minutes} min`;
  }
  return `${remainder} sec`;
}

export function formatTotalDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return "0 min";
  }
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return `${minutes} min`;
  }
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours} hr ${remainder} min` : `${hours} hr`;
}

export function formatPercent(rate: number, digits = 1): string {
  const bounded = Math.max(0, Math.min(1, Number.isFinite(rate) ? rate : 0));
  return `${(bounded * 100).toFixed(digits)}%`;
}

export function formatPp(difference: number): string {
  if (!Number.isFinite(difference)) {
    return "0.0 points";
  }
  if (difference > 0.049) {
    return `+${difference.toFixed(1)} points`;
  }
  if (difference < -0.049) {
    return `\u2212${Math.abs(difference).toFixed(1)} points`;
  }
  return "0.0 points";
}

export function formatScore(score: number): string {
  return Number.isFinite(score) ? score.toFixed(2) : "0.00";
}

const dateFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});

const dateTimeFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const compactFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
});

const monthYearFormatter = new Intl.DateTimeFormat("en-GB", {
  month: "long",
  year: "numeric",
});

function parsedDate(value: string | null | undefined): Date | null {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatDate(value: string | null | undefined): string {
  const date = parsedDate(value);
  return date ? dateFormatter.format(date) : "Unknown date";
}

export function formatDateTime(value: string | null | undefined): string {
  const date = parsedDate(value);
  return date ? dateTimeFormatter.format(date) : "Unknown date";
}

export function formatCompactDate(value: string | null | undefined): string {
  const date = parsedDate(value);
  return date ? compactFormatter.format(date) : "—";
}

export function formatMonthYear(value: string | null | undefined): string {
  const date = parsedDate(value);
  return date ? monthYearFormatter.format(date) : "Unknown date";
}

export function formatGroupDateRange(group: ComparisonGroup): string {
  if (!group.date_start && !group.date_end) {
    return "Dates unavailable";
  }
  const start = group.date_start ? formatDate(group.date_start) : "Unknown";
  const end = group.date_end ? formatDate(group.date_end) : "Unknown";
  return start === end ? start : `${start} – ${end}`;
}

export function toLocalDateTimeInput(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const pad = (component: number) => String(component).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function nowForDateTimeInput(): string {
  return toLocalDateTimeInput(new Date());
}

export function fromLocalDateTimeInput(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

export function titleFromFilename(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? filename;
  const withoutExtension = base.replace(/\.[^.]+$/, "");
  const words = withoutExtension.replace(/[_-]+/g, " ").trim();
  if (!words) {
    return "Untitled recording";
  }
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 KB";
  }
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const AUDIO_EXTENSIONS = [".wav", ".flac", ".mp3", ".ogg"] as const;

export function audioFileProblem(file: File): string | null {
  const lower = file.name.toLowerCase();
  if (!AUDIO_EXTENSIONS.some((extension) => lower.endsWith(extension))) {
    return "Use a WAV, FLAC, MP3, or Ogg Vorbis file.";
  }
  if (file.size === 0) {
    return "This file is empty.";
  }
  if (file.size > 80 * 1024 * 1024) {
    return "This file is larger than the 80 MB upload limit.";
  }
  return null;
}

export function analysisStatusLabel(status: AnalysisStatus): string {
  switch (status) {
    case "not_analyzed":
      return "No results yet";
    case "queued":
      return "Waiting";
    case "running":
      return "Listening";
    case "completed":
      return "Results ready";
    case "failed":
      return "Results failed";
  }
}

export function isAnalysisActive(status: AnalysisStatus): boolean {
  return status === "queued" || status === "running";
}

export function sourceLabel(source: Recording["source"]): string {
  return source === "browser_recording" ? "Microphone" : "Uploaded";
}

export function classificationLabel(classification: Classification): string {
  switch (classification) {
    case "detected_more":
      return "Heard more";
    case "detected_less":
      return "Heard less";
    case "newly_detected":
      return "New";
    case "similar":
      return "About the same";
    case "not_detected":
      return "Not found";
  }
}

export function classificationExplanation(
  classification: Classification,
  changeThreshold: number,
): string {
  switch (classification) {
    case "detected_more":
      return `This sound was found more often, by at least ${changeThreshold.toFixed(0)} points.`;
    case "detected_less":
      return `This sound was found less often, by at least ${changeThreshold.toFixed(0)} points.`;
    case "newly_detected":
      return "This sound appeared in the recent recordings but not the earlier ones.";
    case "similar":
      return `The difference was smaller than ${changeThreshold.toFixed(0)} points.`;
    case "not_detected":
      return "This sound was not found in either group.";
  }
}

export function deltaTone(difference: number): "fading" | "rising" | "steady" {
  if (difference <= -0.05) {
    return "fading";
  }
  if (difference >= 0.05) {
    return "rising";
  }
  return "steady";
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    return error.detail;
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return "Something went wrong. Try again.";
}

export function compareRecordings(
  a: Pick<Recording, "recorded_at" | "id">,
  b: Pick<Recording, "recorded_at" | "id">,
): number {
  return new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime() || a.id - b.id;
}

export interface SuggestedGroups {
  baseline: number[];
  recent: number[];
}

export function suggestComparisonGroups(
  recordings: Array<Pick<Recording, "id" | "recorded_at" | "analysis_status">>,
): SuggestedGroups {
  const analyzed = recordings
    .filter((recording) => recording.analysis_status === "completed")
    .slice()
    .sort(compareRecordings);
  if (analyzed.length < 2) {
    return { baseline: [], recent: [] };
  }
  const midpoint = Math.floor(analyzed.length / 2);
  return {
    baseline: analyzed.slice(0, midpoint).map((item) => item.id),
    recent: analyzed.slice(midpoint).map((item) => item.id),
  };
}

export function shortHash(hash: string): string {
  return hash.slice(0, 12);
}

export function truncate(value: string, length: number): string {
  if (value.length <= length) {
    return value;
  }
  return `${value.slice(0, Math.max(0, length - 1)).trimEnd()}…`;
}

export function rateForRecording(result: ComparisonResult, recordingId: number): number {
  const entry =
    result.baseline_recording_rates.find((item) => item.recording_id === recordingId) ??
    result.recent_recording_rates.find((item) => item.recording_id === recordingId);
  return entry?.detection_rate ?? 0;
}

export function groupLabel(group: ComparisonGroup): string {
  return `${group.recording_count} ${pluralize(group.recording_count, "recording")}`;
}

export function buildObituaryCopy(
  comparison: Comparison,
  result: ComparisonResult,
): string {
  const baselineRange = formatGroupDateRange(comparison.baseline);
  const recentRange = formatGroupDateRange(comparison.recent);
  return [
    `${result.label} — ${result.fading ? "a fading sound" : "a comparison reading"}`,
    `${comparison.place_name}`,
    "",
    `Earlier (${comparison.baseline.recording_count} ${pluralize(comparison.baseline.recording_count, "recording")}, ${baselineRange}): found in ${formatPercent(result.baseline_rate)} of moments on average.`,
    `Recent (${comparison.recent.recording_count} ${pluralize(comparison.recent.recording_count, "recording")}, ${recentRange}): found in ${formatPercent(result.recent_rate)} of moments on average.`,
    `Difference: ${formatPp(result.difference_pp)}.`,
    "",
    "This reading shows a change in what the sound reader found across the selected recordings. It is not proof that the sound has gone, and it does not explain why. Microphone, weather, time of day, and recording conditions may all play a part.",
    "",
    `Comparison #${comparison.id} · sound reader ${comparison.model_name} · match level ${comparison.threshold.toFixed(2)} · local archive`,
  ].join("\n");
}

export function selectedRecordingsLabel(count: number): string {
  return `${count} ${pluralize(count, "recording")} selected`;
}
