import { useId, useMemo } from "react";
import { cx } from "../utils";

interface WaveformProps {
  peaks: number[];
  progress?: number;
  bars?: number;
  className?: string;
  quiet?: boolean;
}

export function samplePeaks(peaks: number[], barCount: number): number[] {
  if (peaks.length === 0) {
    return [];
  }
  const sampled: number[] = [];
  const maximum = Math.max(...peaks, 0.001);
  for (let index = 0; index < barCount; index += 1) {
    const start = Math.floor((index * peaks.length) / barCount);
    const end = Math.max(
      start + 1,
      Math.floor(((index + 1) * peaks.length) / barCount),
    );
    let value = 0;
    for (let cursor = start; cursor < end; cursor += 1) {
      value = Math.max(value, peaks[cursor] ?? 0);
    }
    const normalized = Math.max(0.025, Math.min(1, value / maximum));
    sampled.push(Math.pow(normalized, 0.62));
  }
  return sampled;
}

export function Waveform({
  peaks,
  progress = 0,
  bars = 190,
  className,
  quiet = false,
}: WaveformProps) {
  const clipId = useId().replace(/:/g, "");
  const sampled = useMemo(() => samplePeaks(peaks, bars), [peaks, bars]);
  const height = 116;
  const barWidth = 1000 / bars;
  const clip = Math.max(0, Math.min(1, progress));

  if (sampled.length === 0) {
    return (
      <div className={cx("waveform waveform--empty", className)} aria-hidden="true">
        <span className="waveform__rest" />
      </div>
    );
  }

  return (
    <svg
      className={cx(
        "waveform",
        quiet && "waveform--quiet",
        className,
      )}
      viewBox={`0 0 1000 ${height}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <clipPath id={`played-${clipId}`}>
          <rect x="0" y="0" width={clip * 1000} height={height} />
        </clipPath>
      </defs>
      <line
        x1="0"
        y1={height / 2}
        x2="1000"
        y2={height / 2}
        className="waveform__axis"
      />
      {sampled.map((value, index) => {
        const barHeight = Math.max(2, value * (height - 16));
        const x = index * barWidth + barWidth * 0.16;
        return (
          <rect
            key={index}
            x={x}
            y={(height - barHeight) / 2}
            width={Math.max(1.2, barWidth * 0.58)}
            height={barHeight}
            rx={0.7}
            className="waveform__bar"
          />
        );
      })}
      <g clipPath={`url(#played-${clipId})`}>
        {sampled.map((value, index) => {
          const barHeight = Math.max(2, value * (height - 16));
          const x = index * barWidth + barWidth * 0.16;
          return (
            <rect
              key={index}
              x={x}
              y={(height - barHeight) / 2}
              width={Math.max(1.2, barWidth * 0.58)}
              height={barHeight}
              rx={0.7}
              className="waveform__bar-played"
            />
          );
        })}
      </g>
      <line
        x1={clip * 1000}
        y1="3"
        x2={clip * 1000}
        y2={height - 3}
        className="waveform__playhead"
      />
    </svg>
  );
}
