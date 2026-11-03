import type { ReactNode } from "react";
import { cx } from "../utils";

export function ClassTag({
  label,
  rate,
  tone = "neutral",
  title,
}: {
  label: string;
  rate?: string;
  tone?: "neutral" | "amber" | "fading";
  title?: string;
}) {
  return (
    <span
      className={cx("class-tag", `class-tag--${tone}`)}
      title={title}
    >
      <span>{label}</span>
      {rate && <span className="class-tag__rate">{rate}</span>}
    </span>
  );
}

export function ClassTagList({
  labels,
  limit = 3,
}: {
  labels: Array<{ label: string; rate?: string }>;
  limit?: number;
}) {
  return (
    <div className="class-tag-list">
      {labels.slice(0, limit).map((item) => (
        <ClassTag key={item.label} label={item.label} rate={item.rate} />
      ))}
      {labels.length > limit && (
        <span className="class-tag class-tag--more">
          +{labels.length - limit}
        </span>
      )}
    </div>
  );
}

export function DataValue({
  label,
  value,
  hint,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
}) {
  return (
    <div className="data-value">
      <span className="data-value__label">{label}</span>
      <span className="data-value__value">{value}</span>
      {hint && <span className="data-value__hint">{hint}</span>}
    </div>
  );
}
