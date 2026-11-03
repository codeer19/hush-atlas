import type {
  Classification,
  Comparison,
  ComparisonResult,
} from "../types";

export interface OnDeviceMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ReflectionContext {
  comparisonId: number;
  placeName: string;
  label: string;
  baselineRate: number;
  recentRate: number;
  differencePp: number;
  classification: Classification;
  fading: boolean;
  baselineRecordingCount: number;
  recentRecordingCount: number;
  baselineWindowCount: number;
  recentWindowCount: number;
  threshold: number;
  fadingThresholdPp: number;
  baselineDateStart: string | null;
  baselineDateEnd: string | null;
  recentDateStart: string | null;
  recentDateEnd: string | null;
  createdAt: string;
}

export class ReflectionValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReflectionValidationError";
  }
}

const FORBIDDEN_PATTERNS = new RegExp(
  "\\b(" +
    [
      "caused by",
      "because of",
      "due to",
      "as a result of",
      "led to",
      "resulted in",
      "extinct",
      "extinction",
      "gone forever",
      "permanently disappeared",
      "never return",
      "proves?",
      "proven",
      "proof that",
      "climate change",
      "pollution",
      "urbanization",
      "poaching",
      "deforestation",
      "weather",
      "season",
      "seasons",
      "seasonal",
      "behavior",
      "behaviour",
      "habitat",
      "environmental conditions",
      "environmental factors",
      "human activity",
      "migration",
      "breeding",
    ].join("|") +
    ")\\b",
  "i",
);

const PERMANENCE_PATTERNS =
  /\b(?:is|are|was|were|has|have|had)\s+(?:gone|vanished|disappeared)\b|\bno longer\s+(?:present|there|heard|detected)\b|\babsent from the place\b/i;

const URL_PATTERN = /https?:\/\/|www\./i;
const PERCENT_PATTERN = /(\d+(?:\.\d+)?)\s*%/g;
const YEAR_PATTERN = /\b(?:19|20)\d{2}\b/g;
const DETECTION_PATTERN = /\b(model|detection|detected|analysis|archive|sound reader)\b/i;

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function percent(value: number): string {
  return (value * 100).toFixed(1);
}

function direction(context: ReflectionContext): string {
  if (context.classification === "newly_detected") {
    return "found MORE often recently; it was not found in the earlier recordings";
  }
  if (context.classification === "similar") {
    return "found about as often recently";
  }
  if (context.differencePp > 0) {
    return "found MORE often recently";
  }
  if (context.differencePp < 0) {
    return "found LESS often recently";
  }
  return "found about as often recently";
}

function difference(context: ReflectionContext): string {
  const value = Math.abs(context.differencePp).toFixed(1);
  if (context.classification === "similar") {
    return `${value} percentage points different; the atlas treats this as a similar share of moments`;
  }
  return `${value} percentage points ${context.differencePp < 0 ? "lower" : "higher"}`;
}

function yearOf(value: string | null): string | null {
  if (!value) {
    return null;
  }
  const year = value.slice(0, 4);
  return /^\d{4}$/.test(year) ? year : null;
}

export function buildReflectionContext(
  comparison: Comparison,
  result: ComparisonResult,
): ReflectionContext {
  return {
    comparisonId: comparison.id,
    placeName: comparison.place_name,
    label: result.label,
    baselineRate: result.baseline_rate,
    recentRate: result.recent_rate,
    differencePp: result.difference_pp,
    classification: result.classification,
    fading: result.fading,
    baselineRecordingCount: comparison.baseline.recording_count,
    recentRecordingCount: comparison.recent.recording_count,
    baselineWindowCount: comparison.baseline.window_count,
    recentWindowCount: comparison.recent.window_count,
    threshold: comparison.threshold,
    fadingThresholdPp: comparison.fading_threshold_pp,
    baselineDateStart: comparison.baseline.date_start,
    baselineDateEnd: comparison.baseline.date_end,
    recentDateStart: comparison.recent.date_start,
    recentDateEnd: comparison.recent.date_end,
    createdAt: comparison.created_at,
  };
}

export function buildReflectionMessages(
  context: ReflectionContext,
): OnDeviceMessage[] {
  const note =
    context.classification === "newly_detected"
      ? "Atlas note: the sound type was not found in the earlier recordings."
      : context.classification === "similar"
        ? "Atlas note: the atlas treats this difference as a similar share of moments."
        : `Atlas classification: ${context.classification}.`;

  const prompt = `Sound-detection result:
Place: ${context.placeName}
Sound type: ${context.label}
Earlier recordings: ${context.label} found in ${percent(context.baselineRate)}% of moments.
Recent recordings: ${context.label} found in ${percent(context.recentRate)}% of moments.
Direction: ${direction(context)}.
Difference: ${difference(context)}.
${note}
Cause: unknown.

Write two short paragraphs, about 60-90 words total. In the first paragraph, describe the earlier and recent detection rates and the direction of the difference. In the second paragraph, say the cause is unknown and that this describes only what the sound reader detected. Do not mention weather, seasons, behavior, pollution, habitat, or any possible cause. Do not add dates, species, or new numbers.`;

  return [{ role: "user", content: prompt }];
}

export function sanitizeReflection(text: string): string {
  let cleaned = text.replace(/\r\n?/g, "\n").trim();
  cleaned = cleaned.replace(/<think>[\s\S]*?<\/think>/gi, "");
  cleaned = cleaned.replace(/```[\s\S]*?```/g, "");
  cleaned = cleaned.replace(/^[>\-*#\s]+/gm, "");
  cleaned = cleaned.replace(/\*\*(.*?)\*\*/g, "$1");
  cleaned = cleaned.replace(/^#{1,6}\s*/gm, "");
  cleaned = cleaned.replace(/`/g, "");
  cleaned = cleaned.replace(/[ \t]+/g, " ");
  cleaned = cleaned.replace(/[ \t]+\n/g, "\n");
  cleaned = cleaned.replace(/\n{3,}/g, "\n\n");
  cleaned = cleaned
    .split("")
    .filter((character) => character === "\n" || character >= " ")
    .join("");
  cleaned = cleaned.trim().replace(/^[\"'“”]+|[\"'“”]+$/g, "").trim();
  return cleaned.slice(0, 1500).trim();
}

export function validateReflection(
  text: string,
  context: ReflectionContext,
): string {
  const cleaned = sanitizeReflection(text);
  if (!cleaned) {
    throw new ReflectionValidationError("The on-device model returned no text.");
  }
  if (cleaned.length > 1100) {
    throw new ReflectionValidationError(
      "The on-device model response was too long.",
    );
  }

  const words = cleaned.match(/[A-Za-z']+/g) ?? [];
  if (words.length < 30 || words.length > 190) {
    throw new ReflectionValidationError(
      `The on-device model wrote ${words.length} words. The archive accepts 30-190 words.`,
    );
  }
  if (URL_PATTERN.test(cleaned)) {
    throw new ReflectionValidationError(
      "The on-device model response contained a URL.",
    );
  }
  if (FORBIDDEN_PATTERNS.test(cleaned)) {
    throw new ReflectionValidationError(
      "The on-device model response contained an unsupported causal or permanence claim.",
    );
  }
  if (PERMANENCE_PATTERNS.test(cleaned)) {
    throw new ReflectionValidationError(
      "The on-device model response claimed a sound is gone or no longer present.",
    );
  }
  if (!DETECTION_PATTERN.test(cleaned)) {
    throw new ReflectionValidationError(
      "The on-device model response did not clearly describe an observed model detection.",
    );
  }

  const allowedPercentages = [
    round2(context.baselineRate * 100),
    round2(context.recentRate * 100),
    round2(Math.abs(context.differencePp)),
  ];
  for (const value of cleaned.matchAll(PERCENT_PATTERN)) {
    const number = Number(value[1]);
    if (
      !allowedPercentages.some((allowed) => Math.abs(number - allowed) <= 0.55)
    ) {
      throw new ReflectionValidationError(
        `The on-device model cited an unsupported percentage (${value[1]}%).`,
      );
    }
  }

  const allowedYears = new Set<string>();
  for (const value of [
    context.createdAt,
    context.baselineDateStart,
    context.baselineDateEnd,
    context.recentDateStart,
    context.recentDateEnd,
  ]) {
    const year = yearOf(value);
    if (year) {
      allowedYears.add(year);
    }
  }
  for (const year of cleaned.match(YEAR_PATTERN) ?? []) {
    if (!allowedYears.has(year)) {
      throw new ReflectionValidationError(
        `The on-device model introduced an unsupported date (${year}).`,
      );
    }
  }

  return cleaned;
}
