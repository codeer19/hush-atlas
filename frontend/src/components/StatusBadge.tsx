import { Check, CircleDashed, Loader2, Pause, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import type { AnalysisStatus, WalkStatus, WalkStopStatus } from "../types";
import { analysisStatusLabel, cx } from "../utils";

type BadgeStatus = AnalysisStatus | WalkStatus | WalkStopStatus;
type BadgeKind = "analysis" | "walk" | "stop";

const walkLabels: Record<WalkStatus, string> = {
  active: "Walking",
  paused: "Paused",
  completed: "Finished",
};

const stopLabels: Record<WalkStopStatus, string> = {
  ready_to_listen: "Ready to listen",
  listening: "Listening",
  ready_to_record: "Ready to record",
  recording: "Recording",
  recorded: "Saved",
  analysis_pending: "Finding sounds",
  analyzed: "Results ready",
  analysis_failed: "Results failed",
  reviewed: "Checked",
  completed: "Done",
};

function labelFor(status: BadgeStatus, kind: BadgeKind): string {
  if (kind === "walk") {
    return walkLabels[status as WalkStatus] ?? status;
  }
  if (kind === "stop") {
    return stopLabels[status as WalkStopStatus] ?? status;
  }
  return analysisStatusLabel(status as AnalysisStatus);
}

export function StatusBadge({
  status,
  kind = "analysis",
  compact = false,
}: {
  status: BadgeStatus;
  kind?: BadgeKind;
  compact?: boolean;
}) {
  const active =
    status === "queued" ||
    status === "running" ||
    status === "active" ||
    status === "listening" ||
    status === "recording" ||
    status === "analysis_pending";
  const failed = status === "failed" || status === "analysis_failed";
  const finished =
    status === "completed" || status === "analyzed" || status === "reviewed";
  const paused = status === "paused";
  const Icon = failed
    ? TriangleAlert
    : finished
      ? Check
      : paused
        ? Pause
        : active
          ? Loader2
          : CircleDashed;
  return (
    <span
      className={cx(
        "status-badge",
        `status-badge--${status}`,
        kind !== "analysis" && `status-badge--${kind}`,
        compact && "status-badge--compact",
      )}
    >
      <Icon
        size={compact ? 11 : 13}
        className={active ? "spin" : undefined}
        aria-hidden="true"
      />
      {labelFor(status, kind)}
    </span>
  );
}

export function Badge({
  children,
  tone = "neutral",
  className,
}: {
  children: ReactNode;
  tone?: "neutral" | "amber" | "sage" | "fading" | "rising";
  className?: string;
}) {
  return (
    <span className={cx("badge", `badge--${tone}`, className)}>{children}</span>
  );
}
