import { describe, expect, it } from "vitest";
import {
  audioFileProblem,
  buildObituaryCopy,
  classificationExplanation,
  compareRecordings,
  deltaTone,
  formatDate,
  formatDuration,
  formatDurationLong,
  formatPercent,
  formatPp,
  formatScore,
  formatTotalDuration,
  pluralize,
  shortHash,
  suggestComparisonGroups,
  titleFromFilename,
  truncate,
} from "./utils";
import type { Comparison, ComparisonResult, Recording } from "./types";

function localIso(year: number, month: number, day: number, hour = 12) {
  return new Date(year, month - 1, day, hour, 0, 0).toISOString();
}

describe("formatting", () => {
  it("formats durations at minute and hour scale", () => {
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDuration(65.4)).toBe("1:05");
    expect(formatDuration(3661)).toBe("1:01:01");
    expect(formatDuration(-3)).toBe("0:00");
  });

  it("formats human-readable durations", () => {
    expect(formatDurationLong(0)).toBe("0 sec");
    expect(formatDurationLong(45)).toBe("45 sec");
    expect(formatDurationLong(125)).toBe("2 min 5 sec");
    expect(formatDurationLong(7200)).toBe("2 hr");
  });

  it("totals listening time in minutes and hours", () => {
    expect(formatTotalDuration(0)).toBe("0 min");
    expect(formatTotalDuration(95)).toBe("2 min");
    expect(formatTotalDuration(3_725)).toBe("1 hr 2 min");
  });

  it("bounds and rounds detection rates", () => {
    expect(formatPercent(0.1234)).toBe("12.3%");
    expect(formatPercent(0.1234, 0)).toBe("12%");
    expect(formatPercent(1.8)).toBe("100.0%");
    expect(formatPercent(-1)).toBe("0.0%");
  });

  it("formats percentage-point differences with a real minus sign", () => {
    expect(formatPp(4.24)).toBe("+4.2 points");
    expect(formatPp(-4.24)).toBe("\u22124.2 points");
    expect(formatPp(0)).toBe("0.0 points");
  });

  it("formats scores, counts, and hashes", () => {
    expect(formatScore(0.4567)).toBe("0.46");
    expect(formatScore(Number.NaN)).toBe("0.00");
    expect(shortHash("a".repeat(64))).toBe("aaaaaaaaaaaa");
    expect(pluralize(1, "recording")).toBe("recording");
    expect(pluralize(2, "entry", "entries")).toBe("entries");
  });

  it("formats dates in local time", () => {
    const value = localIso(2026, 4, 9);
    expect(formatDate(value)).toBe("09 Apr 2026");
    expect(formatDate(null)).toBe("Unknown date");
  });

  it("defaults empty titles and truncates long text", () => {
    expect(titleFromFilename("C:\\field\\evening_rain.wav")).toBe("Evening rain");
    expect(titleFromFilename("---.wav")).toBe("Untitled recording");
    expect(truncate("a quiet street", 7)).toBe("a quie…");
    expect(truncate("a quiet street", 8)).toBe("a quiet…");
    expect(truncate("short", 20)).toBe("short");
    expect(truncate("exact", 5)).toBe("exact");
  });
});

describe("comparison helpers", () => {
  it("sorts recordings by date, then id", () => {
    const items = [
      { id: 3, recorded_at: localIso(2026, 1, 2) },
      { id: 1, recorded_at: localIso(2026, 1, 1) },
      { id: 2, recorded_at: localIso(2026, 1, 1) },
    ];
    expect(items.slice().sort(compareRecordings).map((item) => item.id)).toEqual([
      1, 2, 3,
    ]);
  });

  it("splits only analyzed recordings at the midpoint", () => {
    const recordings = [
      { id: 1, recorded_at: localIso(2026, 1, 1), analysis_status: "completed" as const },
      { id: 2, recorded_at: localIso(2026, 2, 1), analysis_status: "failed" as const },
      { id: 3, recorded_at: localIso(2026, 3, 1), analysis_status: "completed" as const },
      { id: 4, recorded_at: localIso(2026, 4, 1), analysis_status: "completed" as const },
    ];
    expect(suggestComparisonGroups(recordings)).toEqual({
      baseline: [1],
      recent: [3, 4],
    });
    expect(
      suggestComparisonGroups([
        { id: 1, recorded_at: localIso(2026, 1, 1), analysis_status: "completed" },
      ]),
    ).toEqual({ baseline: [], recent: [] });
  });

  it("describes delta direction", () => {
    expect(deltaTone(-2)).toBe("fading");
    expect(deltaTone(2)).toBe("rising");
    expect(deltaTone(0)).toBe("steady");
  });

  it("explains classifications using the active change threshold", () => {
    expect(classificationExplanation("detected_less", 12)).toContain("12 points");
    expect(classificationExplanation("newly_detected", 10)).toContain(
      "recent recordings",
    );
  });

  it("validates local audio files by extension and size", () => {
    expect(
      audioFileProblem(new File(["abc"], "field.wav", { type: "audio/wav" })),
    ).toBeNull();
    expect(audioFileProblem(new File(["abc"], "field.aiff"))).toContain("WAV");
    expect(audioFileProblem(new File([], "empty.mp3"))).toContain("empty");
    expect(
      audioFileProblem(
        new File([new Uint8Array(80 * 1024 * 1024 + 1)], "large.flac"),
      ),
    ).toContain("80 MB");
  });
});

describe("obituary copy", () => {
  const comparison = {
    id: 7,
    place_name: "The Sample Courtyard",
    baseline: { recording_count: 2 },
    recent: { recording_count: 2 },
    model_name: "YAMNet",
    threshold: 0.2,
  } as unknown as Comparison;

  const result = {
    label: "Bird",
    fading: true,
    baseline_rate: 0.42,
    recent_rate: 0.12,
    difference_pp: -30,
  } as ComparisonResult;

  it("includes evidence, limits, and local provenance", () => {
    const copy = buildObituaryCopy(comparison, result);
    expect(copy).toContain("Bird — a fading sound");
    expect(copy).toContain("The Sample Courtyard");
    expect(copy).toContain("found in 42.0%");
    expect(copy).toContain("\u221230.0 points");
    expect(copy).toContain("not proof that the sound has gone");
    expect(copy).toContain(
      "Comparison #7 · sound reader YAMNet · match level 0.20 · local archive",
    );
  });
});

describe("recording type sanity", () => {
  it("accepts the expected source values", () => {
    const recording: Pick<Recording, "source"> = { source: "browser_recording" };
    expect(recording.source).toBe("browser_recording");
  });
});
