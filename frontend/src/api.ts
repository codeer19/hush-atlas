import type {
  AcousticMap,
  AnalysisJob,
  AnalysisResponse,
  ComparabilityPreview,
  Comparison,
  ComparisonEvidence,
  ComparisonListItem,
  DemoStatus,
  DeleteResponse,
  Fingerprint,
  GemmaStatus,
  Health,
  MessageResponse,
  Mission,
  ModelsStatus,
  Overview,
  Place,
  PlaceDetail,
  Recording,
  RecordingDetail,
  RecordingSource,
  Reflection,
  Route,
  RouteSummary,
  Walk,
  WalkMap,
  WalkStatus,
  WalkStop,
  WalkStopStatus,
  WalkSummary,
} from "./types";

const CONFIGURED_API_ROOT = (import.meta.env.VITE_API_BASE_URL ?? "").trim();
const API_ROOT = (() => {
  const configured = CONFIGURED_API_ROOT.replace(/\/+$/, "");
  if (!configured) {
    return "/api";
  }
  return configured.endsWith("/api") ? configured : `${configured}/api`;
})();
const API_ORIGIN =
  API_ROOT === "/api" ? "" : API_ROOT.slice(0, -"/api".length);

/**
 * The absolute API origin when the frontend talks to a different host, such as
 * a Render backend from a Vercel build. Null for the same-origin dev proxy.
 */
export function apiOrigin(): string | null {
  if (!CONFIGURED_API_ROOT) {
    return null;
  }
  try {
    return new URL(CONFIGURED_API_ROOT).origin;
  } catch {
    return null;
  }
}

export function isRemoteApi(): boolean {
  const origin = apiOrigin();
  if (!origin || typeof window === "undefined") {
    return false;
  }
  return origin !== window.location.origin;
}

/**
 * The API returns asset and report paths as `/api/...`. When the frontend is
 * hosted separately, those paths must point at the API host rather than the
 * static site.
 */
function rewriteApiUrls<T>(value: T): T {
  if (typeof value === "string") {
    if (value === "/api" || value.startsWith("/api/")) {
      return `${API_ORIGIN}${value}` as T;
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => rewriteApiUrls(item)) as T;
  }
  if (value && typeof value === "object") {
    const rewritten: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      rewritten[key] = rewriteApiUrls(item);
    }
    return rewritten as T;
  }
  return value;
}

export class ApiError extends Error {
  readonly status: number;
  readonly detail: string;

  constructor(status: number, detail: string) {
    super(detail);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
  }
}

function firstValidationMessage(payload: unknown): string | null {
  if (!payload || typeof payload !== "object" || !("detail" in payload)) {
    return null;
  }
  const detail = (payload as { detail: unknown }).detail;
  if (typeof detail === "string") {
    return detail;
  }
  if (Array.isArray(detail)) {
    for (const item of detail) {
      if (item && typeof item === "object" && "msg" in item) {
        const message = String((item as { msg: unknown }).msg).replace(
          /^Value error,\s*/i,
          "",
        );
        if (message) {
          return message;
        }
      }
    }
  }
  return null;
}

async function request<T>(
  path: string,
  init: RequestInit = {},
  timeoutMs = 30_000,
): Promise<T> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${API_ROOT}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        ...(init.body instanceof FormData
          ? {}
          : init.body
            ? { "Content-Type": "application/json" }
            : {}),
        ...init.headers,
      },
    });
    let payload: unknown = null;
    const text = await response.text();
    if (text) {
      try {
        payload = JSON.parse(text) as unknown;
      } catch {
        payload = text;
      }
    }
    if (!response.ok) {
      const detail =
        firstValidationMessage(payload) ??
        (typeof payload === "string" && payload.trim()
          ? payload
          : `The archive returned HTTP ${response.status}.`);
      throw new ApiError(response.status, detail);
    }
    return rewriteApiUrls(payload) as T;
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new ApiError(
        0,
        "The local archive took too long to respond. The task may still be running; try refreshing.",
      );
    }
    throw new ApiError(
      0,
      "The Hush Atlas server is not reachable. Check the connection and try again.",
    );
  } finally {
    window.clearTimeout(timer);
  }
}

function jsonBody(value: unknown): string {
  return JSON.stringify(value);
}

export interface RecordingUpload {
  file: File;
  title?: string;
  notes?: string;
  recordedAt: string;
  source: RecordingSource;
}

export interface WalkCreatePayload {
  mission_key: string;
  place_id?: number;
  route_id?: number;
  title?: string;
  notes?: string;
  route_name?: string;
  route_description?: string;
  route_notes?: string;
  recording_duration_seconds?: number;
  stops?: Array<{
    name: string;
    notes?: string;
    latitude?: number | null;
    longitude?: number | null;
  }>;
}

export const api = {
  health: () => request<Health>("/health"),

  overview: () => request<Overview>("/overview"),

  missions: () => request<Mission[]>("/missions"),

  places: () => request<Place[]>("/places"),

  place: (placeId: number) => request<PlaceDetail>(`/places/${placeId}`),

  createPlace: (name: string, description: string) =>
    request<Place>("/places", {
      method: "POST",
      body: jsonBody({ name, description }),
    }),

  updatePlace: (
    placeId: number,
    patch: { name?: string; description?: string },
  ) =>
    request<Place>(`/places/${placeId}`, {
      method: "PATCH",
      body: jsonBody(patch),
    }),

  deletePlace: (placeId: number) =>
    request<DeleteResponse>(`/places/${placeId}`, { method: "DELETE" }),

  uploadRecording: (placeId: number, upload: RecordingUpload) => {
    const form = new FormData();
    form.append("file", upload.file, upload.file.name);
    form.append("title", upload.title ?? "");
    form.append("notes", upload.notes ?? "");
    form.append("recorded_at", upload.recordedAt);
    form.append("source", upload.source);
    return request<Recording>(`/places/${placeId}/recordings`, {
      method: "POST",
      body: form,
    }, 120_000);
  },

  recording: (recordingId: number) =>
    request<RecordingDetail>(`/recordings/${recordingId}`),

  updateRecording: (
    recordingId: number,
    patch: { title?: string; notes?: string; recorded_at?: string },
  ) =>
    request<Recording>(`/recordings/${recordingId}`, {
      method: "PATCH",
      body: jsonBody(patch),
    }),

  deleteRecording: (recordingId: number) =>
    request<DeleteResponse>(`/recordings/${recordingId}`, { method: "DELETE" }),

  analyzeRecording: (
    recordingId: number,
    options: { threshold?: number; force?: boolean } = {},
  ) =>
    request<AnalysisJob>(`/recordings/${recordingId}/analyze`, {
      method: "POST",
      body: jsonBody({
        threshold: options.threshold ?? null,
        force: options.force ?? false,
      }),
    }),

  analysis: (recordingId: number) =>
    request<AnalysisResponse>(`/recordings/${recordingId}/analysis`),

  map: (placeId: number) =>
    request<AcousticMap>(`/places/${placeId}/map`),

  routes: () => request<RouteSummary[]>("/routes"),

  route: (routeId: number) => request<Route>(`/routes/${routeId}`),

  walks: (status?: WalkStatus) =>
    request<WalkSummary[]>(`/walks${status ? `?status=${status}` : ""}`),

  walk: (sessionId: number) => request<Walk>(`/walks/${sessionId}`),

  createWalk: (payload: WalkCreatePayload) =>
    request<Walk>(
      "/walks",
      {
        method: "POST",
        body: jsonBody(payload),
      },
      60_000,
    ),

  updateWalk: (
    sessionId: number,
    patch: { status?: WalkStatus; notes?: string },
  ) =>
    request<Walk>(`/walks/${sessionId}`, {
      method: "PATCH",
      body: jsonBody(patch),
    }),

  deleteWalk: (sessionId: number) =>
    request<DeleteResponse>(`/walks/${sessionId}`, { method: "DELETE" }),

  updateWalkStop: (
    sessionId: number,
    stopId: number,
    patch: { observation?: string; status?: WalkStopStatus },
  ) =>
    request<WalkStop>(`/walks/${sessionId}/stops/${stopId}`, {
      method: "PATCH",
      body: jsonBody(patch),
    }),

  uploadWalkStopRecording: (
    sessionId: number,
    stopId: number,
    upload: RecordingUpload,
  ) => {
    const form = new FormData();
    form.append("file", upload.file, upload.file.name);
    form.append("title", upload.title ?? "");
    form.append("notes", upload.notes ?? "");
    form.append("recorded_at", upload.recordedAt);
    form.append("source", upload.source);
    return request<Recording>(
      `/walks/${sessionId}/stops/${stopId}/recording`,
      { method: "POST", body: form },
      120_000,
    );
  },

  repeatWalk: (sessionId: number) =>
    request<Walk>(`/walks/${sessionId}/repeat`, { method: "POST" }, 60_000),

  walkMap: (sessionId: number) => request<WalkMap>(`/walks/${sessionId}/map`),

  walkComparisonPreview: (sessionId: number, otherSessionId?: number) =>
    request<ComparabilityPreview>(
      `/walks/${sessionId}/comparison-preview${
        otherSessionId ? `?other_session_id=${otherSessionId}` : ""
      }`,
    ),

  compareWalk: (
    sessionId: number,
    payload: {
      other_session_id?: number | null;
      baseline_stop_ids?: number[];
      recent_stop_ids?: number[];
      threshold?: number;
      fading_threshold_pp?: number;
    },
  ) =>
    request<Comparison>(
      `/walks/${sessionId}/compare`,
      {
        method: "POST",
        body: jsonBody(payload),
      },
      120_000,
    ),

  walkReportUrl: (sessionId: number) =>
    `${API_ROOT}/walks/${sessionId}/report`,

  fingerprint: (recordingId: number) =>
    request<Fingerprint>(`/recordings/${recordingId}/fingerprint`),

  comparisonEvidence: (comparisonId: number, classIndex: number) =>
    request<ComparisonEvidence>(
      `/comparisons/${comparisonId}/evidence/${classIndex}`,
    ),

  comparisonReportUrl: (comparisonId: number, classIndex?: number) =>
    `${API_ROOT}/comparisons/${comparisonId}/report${
      classIndex === undefined ? "" : `?class_index=${classIndex}`
    }`,

  comparisons: (placeId?: number) =>
    request<ComparisonListItem[]>(
      `/comparisons${placeId === undefined ? "" : `?place_id=${placeId}`}`,
    ),

  comparison: (comparisonId: number) =>
    request<Comparison>(`/comparisons/${comparisonId}`),

  createComparison: (payload: {
    place_id: number;
    baseline_recording_ids: number[];
    recent_recording_ids: number[];
    threshold: number;
    fading_threshold_pp: number;
  }) =>
    request<Comparison>("/comparisons", {
      method: "POST",
      body: jsonBody(payload),
    }, 60_000),

  existingReflection: (comparisonId: number, classIndex: number) =>
    request<Reflection>(
      `/comparisons/${comparisonId}/reflection/${classIndex}`,
      {},
      20_000,
    ),

  generateReflection: (
    comparisonId: number,
    classIndex: number,
    regenerate = false,
  ) =>
    request<Reflection>(
      `/comparisons/${comparisonId}/reflection`,
      {
        method: "POST",
        body: jsonBody({ class_index: classIndex, regenerate }),
      },
      150_000,
    ),

  demo: () => request<DemoStatus>("/demo"),

  prepareDemo: () =>
    request<DemoStatus>("/demo/prepare", { method: "POST" }, 30_000),

  removeDemo: () =>
    request<MessageResponse>("/demo", { method: "DELETE" }, 120_000),

  models: () => request<ModelsStatus>("/models/status", {}, 15_000),

  gemma: () => request<GemmaStatus>("/models/gemma", {}, 15_000),

  selectGemma: (model: string) =>
    request<GemmaStatus>("/models/gemma", {
      method: "PUT",
      body: jsonBody({ model }),
    }, 20_000),
};
