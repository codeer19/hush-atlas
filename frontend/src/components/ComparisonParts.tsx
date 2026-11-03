import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import type { Classification } from "../types";
import {
  classificationLabel,
  cx,
  deltaTone,
  formatPercent,
  formatPp,
} from "../utils";

export function RateComparison({
  baselineRate,
  recentRate,
  baselineLabel = "Earlier",
  recentLabel = "Recent",
  large = false,
}: {
  baselineRate: number;
  recentRate: number;
  baselineLabel?: string;
  recentLabel?: string;
  large?: boolean;
}) {
  return (
    <div className={cx("rate-compare", large && "rate-compare--large")}>
      <div className="rate-compare__side">
        <span className="rate-compare__label">{baselineLabel}</span>
        <strong className="rate-compare__value">{formatPercent(baselineRate)}</strong>
        <span className="rate-compare__track" aria-hidden="true">
          <span style={{ width: `${Math.min(100, baselineRate * 100)}%` }} />
        </span>
      </div>
      <div className="rate-compare__arrow" aria-hidden="true">
        <ArrowDownRight size={large ? 20 : 15} />
      </div>
      <div className="rate-compare__side rate-compare__side--recent">
        <span className="rate-compare__label">{recentLabel}</span>
        <strong className="rate-compare__value">{formatPercent(recentRate)}</strong>
        <span className="rate-compare__track" aria-hidden="true">
          <span style={{ width: `${Math.min(100, recentRate * 100)}%` }} />
        </span>
      </div>
    </div>
  );
}

export function DeltaDisplay({
  difference,
  showIcon = true,
}: {
  difference: number;
  showIcon?: boolean;
}) {
  const tone = deltaTone(difference);
  const Icon =
    tone === "fading"
      ? ArrowDownRight
      : tone === "rising"
        ? ArrowUpRight
        : Minus;
  return (
    <span className={cx("delta", `delta--${tone}`)}>
      {showIcon && <Icon size={13} aria-hidden="true" />}
      {formatPp(difference)}
    </span>
  );
}

export function ClassificationBadge({
  classification,
  fading,
}: {
  classification: Classification;
  fading: boolean;
}) {
  const tone = fading
    ? "fading"
    : classification === "detected_more"
      ? "rising"
      : classification === "newly_detected"
        ? "amber"
        : "neutral";
  return (
    <span className={cx("classification-badge", `classification-badge--${tone}`)}>
      {fading ? "Heard less" : classificationLabel(classification)}
    </span>
  );
}
