import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { ReflectionPanel } from "./ReflectionPanel";
import {
  ClassificationBadge,
  DeltaDisplay,
  RateComparison,
} from "./ComparisonParts";
import { StatusBadge } from "./StatusBadge";
import { ToastProvider } from "./Toast";
import type { ReflectionContext } from "../ondevice/prompt";

const reflectionContext: ReflectionContext = {
  comparisonId: 8,
  placeName: "Test place",
  label: "Bird",
  baselineRate: 0.421,
  recentRate: 0.118,
  differencePp: -30.3,
  classification: "detected_less",
  fading: true,
  baselineRecordingCount: 4,
  recentRecordingCount: 4,
  baselineWindowCount: 40,
  recentWindowCount: 40,
  threshold: 0.2,
  fadingThresholdPp: 10,
  baselineDateStart: "2026-01-01",
  baselineDateEnd: "2026-02-01",
  recentDateStart: "2026-03-01",
  recentDateEnd: "2026-04-01",
  createdAt: "2026-04-02T10:00:00Z",
};

describe("shared evidence displays", () => {
  it("renders both detection rates and their group labels", () => {
    render(
      <RateComparison
        baselineRate={0.421}
        recentRate={0.118}
        baselineLabel="Earlier group"
        recentLabel="Recent group"
      />,
    );

    expect(screen.getByText("Earlier group")).toBeInTheDocument();
    expect(screen.getByText("Recent group")).toBeInTheDocument();
    expect(screen.getByText("42.1%")).toBeInTheDocument();
    expect(screen.getByText("11.8%")).toBeInTheDocument();
  });

  it("uses the fading tone for a negative difference", () => {
    const { container } = render(<DeltaDisplay difference={-4.2} />);
    expect(screen.getByText("\u22124.2 points")).toBeInTheDocument();
    expect(container.querySelector(".delta--fading")).toBeInTheDocument();
  });

  it("marks fading over the underlying classification", () => {
    const { container } = render(
      <ClassificationBadge classification="detected_less" fading />,
    );
    expect(screen.getByText("Heard less")).toBeInTheDocument();
    expect(
      container.querySelector(".classification-badge--fading"),
    ).toBeInTheDocument();
  });

  it("communicates analysis state in text, not colour alone", () => {
    const { rerender } = render(<StatusBadge status="running" />);
    expect(screen.getByText("Listening")).toBeInTheDocument();

    rerender(<StatusBadge status="completed" />);
    expect(screen.getByText("Results ready")).toBeInTheDocument();

    rerender(<StatusBadge status="failed" />);
    expect(screen.getByText("Results failed")).toBeInTheDocument();
  });
});

describe("reflection panel", () => {
  it("labels and explains the deterministic fallback", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          comparison_id: 8,
          class_index: 3,
          label: "Bird",
          source: "deterministic-fallback",
          model_name: null,
          text: "The sound reader found Bird less often in the recent recordings. This describes what it found only.",
          cached: false,
          gemma_available: false,
          warning: null,
          created_at: null,
        }),
    } as Response);
    vi.stubGlobal("fetch", fetchMock);

    render(
      <MemoryRouter>
        <ToastProvider>
          <ReflectionPanel
            comparisonId={8}
            classIndex={3}
            label="Bird"
            context={reflectionContext}
          />
        </ToastProvider>
      </MemoryRouter>,
    );

    expect(
      await screen.findByText(/The sound reader found Bird less often/),
    ).toBeInTheDocument();
    expect(await screen.findByText("Plain reading")).toBeInTheDocument();
    expect(screen.getByText(/No AI model was used/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Write a reflection/i }),
    ).toBeDisabled();
    expect(
      screen.getByRole("link", { name: /See device requirements/i }),
    ).toHaveAttribute("href", "/about#on-device-ai");
  });
});
