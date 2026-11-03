import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { App } from "./App";
import type {
  Mission,
  Overview,
  Place,
  RouteSummary,
  WalkSummary,
} from "./types";

const overview: Overview = {
  place_count: 1,
  recording_count: 2,
  analyzed_count: 2,
  total_duration_seconds: 90,
  latest_recording: {
    id: 5,
    place_id: 1,
    place_name: "The Yard",
    title: "Evening rain",
    recorded_at: "2026-04-09T18:00:00Z",
    analysis_status: "completed",
  },
  notable_changes: [],
  demo_available: false,
};

const missions: Mission[] = [
  {
    key: "five-sounds",
    title: "Five Sounds",
    short_description: "Walk a short loop and listen closely at several ordinary places.",
    purpose: "A listening exercise.",
    estimated_duration_minutes: 10,
    duration_is_estimate: true,
    suggested_stops: 4,
    minimum_stops: 2,
    maximum_stops: 8,
    what_you_will_do: ["Listen", "Record", "Review"],
    comparison_mode: "within-session",
    default_stop_names: ["One", "Two", "Three", "Four"],
  },
  {
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
  },
  {
    key: "find-the-quiet",
    title: "Find the Quiet",
    short_description: "Visit several safe places and compare detected patterns.",
    purpose: "A comparative listening walk.",
    estimated_duration_minutes: 15,
    duration_is_estimate: true,
    suggested_stops: 4,
    minimum_stops: 2,
    maximum_stops: 8,
    what_you_will_do: ["Visit", "Record", "Investigate"],
    comparison_mode: "between-stops",
    default_stop_names: ["One", "Two", "Three", "Four"],
  },
];

const place: Place = {
  id: 1,
  name: "The Yard",
  description: "A small courtyard behind the house.",
  is_demo: false,
  created_at: "2026-04-01T10:00:00Z",
  updated_at: "2026-04-09T18:00:00Z",
  recording_count: 2,
  analyzed_count: 2,
  last_recorded_at: "2026-04-09T18:00:00Z",
};

const completedWalk: WalkSummary = {
  id: 3,
  mission_key: "two-moments",
  mission_title: "One Place, Two Moments",
  title: "The yard, first visit",
  status: "completed",
  place_id: 1,
  place_name: "The Yard",
  is_demo: false,
  route_id: 2,
  route_name: "Yard loop",
  started_at: "2026-04-09T17:30:00Z",
  completed_at: "2026-04-09T18:00:00Z",
  stop_count: 2,
  recorded_count: 2,
  analyzed_count: 2,
};

const activeWalk: WalkSummary = {
  id: 4,
  mission_key: "five-sounds",
  mission_title: "Five Sounds",
  title: "An unfinished loop",
  status: "paused",
  place_id: 1,
  place_name: "The Yard",
  is_demo: false,
  route_id: null,
  route_name: null,
  started_at: "2026-04-10T09:00:00Z",
  completed_at: null,
  stop_count: 4,
  recorded_count: 1,
  analyzed_count: 0,
};

const route: RouteSummary = {
  id: 2,
  place_id: 1,
  place_name: "The Yard",
  name: "Yard loop",
  description: "Gate, bench, hedge, tap.",
  notes: "",
  recording_duration_seconds: 30,
  stop_count: 2,
  completed_visit_count: 1,
  last_completed_at: "2026-04-09T18:00:00Z",
  created_at: "2026-04-09T17:00:00Z",
  updated_at: "2026-04-09T18:00:00Z",
};

function jsonResponse(value: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(value),
  } as Response;
}

function installApi(handler: (url: string) => Response) {
  const mock = vi.fn((input: RequestInfo | URL) =>
    Promise.resolve(handler(String(input))),
  );
  vi.stubGlobal("fetch", mock);
  return mock;
}

describe("archive application", () => {
  it("presents the missions and real local counts on the home page", async () => {
    installApi((url) => {
      if (url === "/api/overview") return jsonResponse(overview);
      if (url === "/api/missions") return jsonResponse(missions);
      if (url === "/api/walks") return jsonResponse([completedWalk, activeWalk]);
      if (url === "/api/routes") return jsonResponse([route]);
      return jsonResponse({ detail: "Unexpected route" }, 404);
    });

    render(
      <MemoryRouter initialEntries={["/"]}>
        <App />
      </MemoryRouter>,
    );

    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "Map the world by listening.",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Explore the sounds around you. Discover what you might miss.",
      ),
    ).toBeInTheDocument();

    for (const mission of missions) {
      expect(
        screen.getByRole("heading", { level: 3, name: mission.title }),
      ).toBeInTheDocument();
    }
    expect(
      screen.getByRole("link", { name: /Five Sounds.*Start this walk/i }),
    ).toHaveAttribute("href", "/walks/new?mission=five-sounds");

    const stats = await screen.findByLabelText("Your atlas counts");
    expect(within(stats).getByText("Places").nextSibling).toHaveTextContent("1");
    expect(within(stats).getByText("Recordings").nextSibling).toHaveTextContent(
      "2",
    );
    expect(
      within(stats).getByText("Walks finished").nextSibling,
    ).toHaveTextContent("1");
    expect(within(stats).getByText("Routes").nextSibling).toHaveTextContent(
      "1",
    );

    expect(
      screen.getByRole("link", { name: /An unfinished loop.*Keep walking/i }),
    ).toHaveAttribute("href", "/walks/4");
    expect(screen.getByRole("link", { name: /Yard loop/ })).toHaveAttribute(
      "href",
      "/routes/2",
    );
  });

  it("renders the archive with places and walks", async () => {
    installApi((url) => {
      if (url === "/api/overview") return jsonResponse(overview);
      if (url === "/api/places") return jsonResponse([place]);
      if (url === "/api/walks") return jsonResponse([completedWalk, activeWalk]);
      return jsonResponse({ detail: "Unexpected route" }, 404);
    });

    render(
      <MemoryRouter initialEntries={["/archive"]}>
        <App />
      </MemoryRouter>,
    );

    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "Everything you have listened to.",
      }),
    ).toBeInTheDocument();
    expect(await screen.findByText("The Yard")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /The Yard A small courtyard/i }),
    ).toHaveAttribute("href", "/places/1");
    expect(
      screen.getByRole("link", { name: /The yard, first visit/ }),
    ).toHaveAttribute("href", "/walks/3");
    expect(
      screen.getByRole("link", { name: /An unfinished loop/ }),
    ).toHaveAttribute("href", "/walks/4");
    expect(screen.getByText("In progress")).toBeInTheDocument();
    expect(screen.getByText("Completed")).toBeInTheDocument();
    expect(screen.getByText("Finished")).toBeInTheDocument();
  });

  it("shows the comparison index and its empty state", async () => {
    installApi((url) => {
      if (url === "/api/comparisons") return jsonResponse([]);
      return jsonResponse({ detail: "Unexpected route" }, 404);
    });

    render(
      <MemoryRouter initialEntries={["/comparisons"]}>
        <App />
      </MemoryRouter>,
    );

    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "Compare two visits.",
      }),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole("heading", {
        level: 2,
        name: "A comparison needs two recordings.",
      }),
    ).toBeInTheDocument();
  });

  it("renders a designed not-found page for unknown local routes", () => {
    const fetchMock = installApi(() =>
      jsonResponse({ detail: "Unexpected request" }, 404),
    );

    render(
      <MemoryRouter initialEntries={["/a-place-that-is-not-here"]}>
        <App />
      </MemoryRouter>,
    );

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "This page is quiet.",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Back to my atlas/i }),
    ).toHaveAttribute("href", "/");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows local model status on the about page", async () => {
    installApi((url) => {
      if (url === "/api/models/status") {
        return jsonResponse({
          audio: {
            status: "ready",
            label: "Sound reader ready",
            detail: "The sound reader is ready. It loads on this device the first time you use it.",
            weights_present: true,
            class_map_present: true,
            dependencies_present: true,
            loaded: false,
            model_version: "1.0",
            class_count: 521,
            weights_sha256: "a".repeat(64),
            class_map_sha256: "b".repeat(64),
          },
          gemma: {
            reachable: true,
            endpoint: "http://127.0.0.1:11434",
            selected_model: null,
            compatible_models: [],
            installed_models: [],
            detail: "The writing tool is running, but no compatible model is installed.",
          },
          offline_ready: true,
          offline_detail: "Finding sounds works offline. Plain readings still work.",
        });
      }
      return jsonResponse({ detail: "Unexpected route" }, 404);
    });

    render(
      <MemoryRouter initialEntries={["/about"]}>
        <App />
      </MemoryRouter>,
    );

    expect(
      await screen.findByText("Finding sounds works offline"),
    ).toBeInTheDocument();
    expect(screen.getByText("521 sound types")).toBeInTheDocument();
    expect(screen.getByText("On-device AI")).toBeInTheDocument();
    expect(screen.getByText("Gemma 2 · 2B")).toBeInTheDocument();
    expect(await screen.findByText("Not supported")).toBeInTheDocument();
    expect(
      screen.getAllByText(/This browser cannot run the on-device model/).length,
    ).toBeGreaterThan(0);
    expect(
      screen.queryByText(/ollama pull gemma3:4b/i),
    ).not.toBeInTheDocument();
  });
});
