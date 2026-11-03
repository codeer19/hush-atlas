import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { NewWalkPage } from "./NewWalkPage";
import { WalkPage } from "./WalkPage";
import { EvidencePage } from "./EvidencePage";
import { ToastProvider } from "../components/Toast";
import type {
  Comparison,
  ComparisonEvidence,
  ComparisonGroup,
  ComparisonResult,
  Mission,
  Place,
  Reflection,
  Walk,
  WalkStop,
} from "../types";

function jsonResponse(value: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(value),
  } as Response;
}

function installApi(
  handler: (url: string, init?: RequestInit) => Response,
): ReturnType<typeof vi.fn> {
  const mock = vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
    Promise.resolve(handler(String(input), init)),
  );
  vi.stubGlobal("fetch", mock);
  return mock;
}

function renderAt(path: string, pattern: string, element: ReactNode) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ToastProvider>
        <Routes>
          <Route path={pattern} element={element} />
          <Route path="/walks/:sessionId" element={<p>Walk ready.</p>} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>,
  );
}

const mission: Mission = {
  key: "two-moments",
  title: "One Place, Two Moments",
  short_description: "Map one familiar place today, then return another day.",
  purpose: "A repeatable field study.",
  estimated_duration_minutes: 12,
  duration_is_estimate: true,
  suggested_stops: 3,
  minimum_stops: 2,
  maximum_stops: 8,
  what_you_will_do: ["Map", "Repeat", "Compare"],
  comparison_mode: "repeat-visit",
  default_stop_names: ["One", "Two", "Three"],
};

const otherMission: Mission = {
  ...mission,
  key: "five-sounds",
  title: "Five Sounds",
  short_description: "Walk a short loop and listen closely at several ordinary places.",
  suggested_stops: 4,
  default_stop_names: ["One", "Two", "Three", "Four"],
};

const place: Place = {
  id: 21,
  name: "The station square",
  description: "A place named in the test.",
  is_demo: false,
  created_at: "2026-10-01T10:00:00Z",
  updated_at: "2026-10-01T10:00:00Z",
  recording_count: 0,
  analyzed_count: 0,
  last_recorded_at: null,
};

const readyStop: WalkStop = {
  id: 11,
  session_id: 4,
  route_stop_id: 1,
  stop_order: 0,
  name: "The gate",
  latitude: null,
  longitude: null,
  observation: "",
  status: "ready_to_listen",
  status_label: "Ready to listen",
  interrupted_recording: false,
  recording: null,
  created_at: "2026-10-01T10:00:00Z",
  updated_at: "2026-10-01T10:00:00Z",
};

const analyzedStop: WalkStop = {
  id: 12,
  session_id: 4,
  route_stop_id: 2,
  stop_order: 1,
  name: "The bench",
  latitude: null,
  longitude: null,
  observation: "Traffic behind the hedge.",
  status: "analyzed",
  status_label: "Analyzed",
  interrupted_recording: false,
  recording: {
    id: 9,
    place_id: 1,
    place_name: "The Yard",
    title: "2. The bench",
    recorded_at: "2026-10-01T10:05:00Z",
    duration_seconds: 30,
    audio_format: "WAV",
    sample_rate: 32000,
    channels: 1,
    source: "browser_recording",
    analysis_status: "completed",
    analysis_error: null,
    audio_url: "/api/recordings/9/audio",
    top_classes: [
      {
        class_index: 100,
        label: "Vehicle",
        detection_rate: 0.4,
        peak_score: 0.91,
      },
    ],
  },
  created_at: "2026-10-01T10:00:00Z",
  updated_at: "2026-10-01T10:06:00Z",
};

const walk: Walk = {
  id: 4,
  mission_key: "two-moments",
  mission_title: "One Place, Two Moments",
  mission_short_description: "Map one familiar place today, then return another day.",
  mission_comparison_mode: "repeat-visit",
  route_id: 2,
  route_name: "Yard loop",
  recording_duration_seconds: 30,
  place_id: 1,
  place_name: "The Yard",
  place_description: "A small courtyard.",
  is_demo: false,
  title: "An unfinished loop",
  status: "active",
  notes: "A test walk.",
  started_at: "2026-10-01T10:00:00Z",
  paused_at: null,
  completed_at: null,
  updated_at: "2026-10-01T10:06:00Z",
  progress: {
    total_stops: 2,
    recorded_stops: 1,
    analyzed_stops: 1,
    failed_analysis_stops: 0,
    reviewed_stops: 0,
    remaining_stops: 2,
  },
  stops: [readyStop, analyzedStop],
  previous_visit: null,
};

function group(recordingIds: number[]): ComparisonGroup {
  return {
    recording_ids: recordingIds,
    recordings: [],
    recording_count: recordingIds.length,
    window_count: 100,
    date_start: "2026-10-01T10:00:00Z",
    date_end: "2026-10-01T10:30:00Z",
  };
}

const result: ComparisonResult = {
  class_index: 100,
  label: "Vehicle",
  baseline_rate: 0.42,
  recent_rate: 0.12,
  difference_pp: -30,
  baseline_detected_windows: 42,
  recent_detected_windows: 12,
  classification: "detected_less",
  fading: true,
  notable: true,
  baseline_recording_rates: [
    {
      recording_id: 1,
      title: "Dawn after rain — sample",
      recorded_at: "2026-10-01T10:00:00Z",
      duration_seconds: 30,
      detection_rate: 0.42,
      detected_windows: 42,
      window_count: 100,
      peak_score: 0.9,
      peak_window_start: 1.2,
      peak_window_end: 1.68,
    },
  ],
  recent_recording_rates: [
    {
      recording_id: 2,
      title: "Evening traffic — sample",
      recorded_at: "2026-10-02T10:00:00Z",
      duration_seconds: 30,
      detection_rate: 0.12,
      detected_windows: 12,
      window_count: 100,
      peak_score: 0.7,
      peak_window_start: 8.4,
      peak_window_end: 8.88,
    },
  ],
};

const stopContext = {
  recording_id: 1,
  stop_id: 11,
  stop_name: "The gate",
  stop_order: 0,
  observation: "A gate hinge, then traffic.",
  session_id: 3,
  session_title: "Baseline visit",
  session_status: "completed" as const,
  route_id: 2,
  route_name: "Yard loop",
};

const comparison: Comparison = {
  id: 7,
  place_id: 1,
  place_name: "The Sample Courtyard",
  baseline_session_id: 3,
  recent_session_id: 4,
  stop_context: [stopContext],
  threshold: 0.2,
  fading_threshold_pp: 10,
  change_threshold_pp: 10,
  baseline: group([1]),
  recent: group([2]),
  warnings: [
    "The sample uses synthesized audio, so this is not environmental evidence.",
  ],
  reliability: "limited",
  summary: {
    class_count: 1,
    fading_count: 1,
    newly_detected_count: 0,
    detected_more_count: 0,
    detected_less_count: 1,
    similar_count: 0,
  },
  results: [result],
  model_name: "YAMNet (AudioSet)",
  model_version: "test-version",
  input_hash: "test-hash",
  created_at: "2026-10-02T12:00:00Z",
};

const evidence: ComparisonEvidence = {
  comparison,
  result,
  baseline_recordings: [
    {
      recording: {
        id: 1,
        title: "Dawn after rain — sample",
        recorded_at: "2026-10-01T10:00:00Z",
        duration_seconds: 30,
        analysis_status: "completed",
        audio_url: "/api/recordings/1/audio",
        waveform_peaks: [0.1, 0.4, 0.2],
        top_classes: [
          {
            class_index: 100,
            label: "Vehicle",
            detection_rate: 0.42,
            peak_score: 0.9,
          },
        ],
        class_events: [
          { start_seconds: 2, end_seconds: 4, model_score: 0.8 },
        ],
      },
      stop_context: stopContext,
    },
  ],
  recent_recordings: [
    {
      recording: {
        id: 2,
        title: "Evening traffic — sample",
        recorded_at: "2026-10-02T10:00:00Z",
        duration_seconds: 30,
        analysis_status: "completed",
        audio_url: "/api/recordings/2/audio",
        waveform_peaks: [0.2],
        top_classes: [
          {
            class_index: 100,
            label: "Vehicle",
            detection_rate: 0.12,
            peak_score: 0.7,
          },
        ],
        class_events: [],
      },
      stop_context: null,
    },
  ],
  evidence_notes: [
    "A sound counts as found in a moment when its match is at or above the chosen level. The group rate is the average of each recording's rate.",
  ],
};

const reflection: Reflection = {
  comparison_id: 7,
  class_index: 100,
  label: "Vehicle",
  source: "deterministic-fallback",
  model_name: null,
  text: "The sound reader found Vehicle less often in the recent recordings. This describes what it found only.",
  cached: false,
  gemma_available: false,
  warning: null,
  created_at: null,
};

const originalGeolocation = navigator.geolocation;

afterEach(() => {
  if (originalGeolocation) {
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: originalGeolocation,
    });
  } else {
    Reflect.deleteProperty(navigator, "geolocation");
  }
});

describe("Soundwalk setup", () => {
  it("preselects the requested mission, defaults manual stops and only asks for coordinates on request", async () => {
    const getCurrentPosition = vi.fn();
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: { getCurrentPosition },
    });
    installApi((url) => {
      if (url === "/api/missions") return jsonResponse([mission, otherMission]);
      if (url === "/api/places") return jsonResponse([]);
      if (url === "/api/routes") return jsonResponse([]);
      return jsonResponse({ detail: "Unexpected route" }, 404);
    });

    renderAt("/walks/new?mission=two-moments", "/walks/new", <NewWalkPage />);

    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "Plan your walk.",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("radio", { name: /One Place, Two Moments/ }),
    ).toHaveAttribute("aria-checked", "true");
    const stopNames = await screen.findAllByLabelText("Stop name");
    expect(stopNames).toHaveLength(3);
    expect(stopNames[0]).toHaveValue("One");
    expect(screen.queryByLabelText("Latitude")).not.toBeInTheDocument();
    expect(getCurrentPosition).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getAllByRole("button", { name: /Add coordinates/ })[0],
    );
    expect(await screen.findByLabelText("Latitude")).toBeInTheDocument();
    expect(screen.getByLabelText("Longitude")).toBeInTheDocument();

    fireEvent.click(
      screen.getAllByRole("button", {
        name: /Use my location/,
      })[0],
    );
    expect(getCurrentPosition).toHaveBeenCalledTimes(1);
  });

  it("creates a manual place and route without a location permission", async () => {
    const fetchMock = installApi((url, init) => {
      if (url === "/api/missions") return jsonResponse([mission, otherMission]);
      if (url === "/api/places" && init?.method === "POST") {
        return jsonResponse(place, 201);
      }
      if (url === "/api/places") return jsonResponse([place]);
      if (url === "/api/routes") return jsonResponse([]);
      if (url === "/api/walks" && init?.method === "POST") {
        return jsonResponse(walk, 201);
      }
      return jsonResponse({ detail: "Unexpected route" }, 404);
    });

    renderAt("/walks/new?mission=two-moments", "/walks/new", <NewWalkPage />);

    const placeSelect = await screen.findByRole("combobox", { name: "Place" });
    fireEvent.change(placeSelect, { target: { value: "" } });
    const nameField = await screen.findByLabelText("New place name");
    fireEvent.change(nameField, {
      target: { value: "The station square" },
    });

    fireEvent.click(screen.getByRole("button", { name: /Start walking/ }));

    expect(await screen.findByText("Walk ready.")).toBeInTheDocument();
    const walkCall = fetchMock.mock.calls.find(
      ([url, init]) =>
        String(url) === "/api/walks" &&
        (init as RequestInit | undefined)?.method === "POST",
    );
    expect(walkCall).toBeDefined();
    const payload = JSON.parse(
      String((walkCall?.[1] as RequestInit | undefined)?.body),
    ) as {
      mission_key: string;
      place_id: number;
      stops: Array<{ name: string; latitude: number | null }>;
    };
    expect(payload.mission_key).toBe("two-moments");
    expect(payload.place_id).toBe(21);
    expect(payload.stops.map((stop) => stop.name)).toEqual([
      "One",
      "Two",
      "Three",
    ]);
    expect(payload.stops.every((stop) => stop.latitude === null)).toBe(true);
    expect(
      fetchMock.mock.calls.some(
        ([url, init]) =>
          String(url) === "/api/places" &&
          (init as RequestInit | undefined)?.method === "POST",
      ),
    ).toBe(true);
    expect(fetchMock.mock.calls.some(([url]) => String(url) === "/api/places")).toBe(
      true,
    );
  });
});

describe("Soundwalk stops", () => {
  it("keeps listening before recording and separates observations from model labels", async () => {
    installApi((url) => {
      if (url === "/api/walks/4") return jsonResponse(walk);
      return jsonResponse({ detail: "Unexpected route" }, 404);
    });

    renderAt("/walks/4", "/walks/:sessionId", <WalkPage />);

    expect(
      await screen.findByRole("heading", { level: 1, name: "An unfinished loop" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Listen before recording.")).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Record from this device" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Save this recording")).not.toBeInTheDocument();

    const observation = screen.getByLabelText(/Your observation/);
    expect(observation).toHaveValue("Traffic behind the hedge.");
    expect(
      screen.getByText(/Your notes and the sound reader's labels are kept separately/i),
    ).toBeInTheDocument();
    expect(screen.getByText("Sounds found")).toBeInTheDocument();
    expect(screen.getByText("Vehicle")).toBeInTheDocument();
    expect(screen.getByText("40.0%")).toBeInTheDocument();
    expect(
      screen.getByText(/not species or known sources/i),
    ).toBeInTheDocument();
  });

  it("preserves the route while paused and offers an explicit resume", async () => {
    const paused: Walk = {
      ...walk,
      status: "paused",
      paused_at: "2026-10-01T10:07:00Z",
      progress: { ...walk.progress, recorded_stops: 0, analyzed_stops: 0 },
      stops: [
        readyStop,
        {
          ...readyStop,
          id: 13,
          route_stop_id: 2,
          stop_order: 1,
          name: "The bench",
          status: "ready_to_record",
          status_label: "Ready to record",
        },
      ],
    };
    installApi((url) => {
      if (url === "/api/walks/4") return jsonResponse(paused);
      return jsonResponse({ detail: "Unexpected route" }, 404);
    });

    renderAt("/walks/4", "/walks/:sessionId", <WalkPage />);

    expect(
      await screen.findByText(/This walk is paused/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Resume/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Resume the walk to record here."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Save this recording")).not.toBeInTheDocument();
  });
});

describe("Evidence investigation", () => {
  it("shows both groups, the method notes, stop context and limits", async () => {
    installApi((url) => {
      if (url === "/api/comparisons/7/evidence/100") {
        return jsonResponse(evidence);
      }
      if (url === "/api/comparisons/7/reflection/100") {
        return jsonResponse(reflection);
      }
      return jsonResponse({ detail: "Unexpected route" }, 404);
    });

    renderAt(
      "/comparisons/7/evidence/100",
      "/comparisons/:comparisonId/evidence/:classIndex",
      <EvidencePage />,
    );

    expect(
      await screen.findByRole("heading", { level: 1, name: "Vehicle" }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Sound details").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Earlier · 1 recording")).toBeInTheDocument();
    expect(screen.getByText("Recent · 1 recording")).toBeInTheDocument();
    expect(screen.getAllByText("42.0%").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText("12.0%").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("42 → 12")).toBeInTheDocument();
    expect(
      screen.getByText(
        "A sound counts as found in a moment when its match is at or above the chosen level. The group rate is the average of each recording's rate.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "The sample uses synthesized audio, so this is not environmental evidence.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getAllByText("A gate hinge, then traffic.").length,
    ).toBeGreaterThanOrEqual(1);

    const baseline = screen.getByRole("region", {
      name: "Earlier recordings.",
    });
    expect(within(baseline).getByText("Dawn after rain — sample")).toBeInTheDocument();
    expect(
      within(baseline).getByText("A gate hinge, then traffic."),
    ).toBeInTheDocument();
    expect(
      within(baseline).getByRole("link", { name: /Sound details/ }),
    ).toHaveAttribute("href", "/recordings/1/fingerprint");

    expect(
      await screen.findByText(/The sound reader found Vehicle less often/),
    ).toBeInTheDocument();
    expect(screen.getByText("Plain reading")).toBeInTheDocument();
    expect(screen.getByText(/Original audio only/)).toBeInTheDocument();
  });
});
