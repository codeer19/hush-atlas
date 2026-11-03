import { useMemo, useState } from "react";
import { ChevronDown, Search } from "lucide-react";
import type { AnalysisClass, AnalysisEvent } from "../types";
import {
  formatDuration,
  formatPercent,
  formatScore,
} from "../utils";

function EventRail({
  duration,
  events,
  label,
  onSeek,
}: {
  duration: number;
  events: AnalysisEvent[];
  label: string;
  onSeek: (seconds: number) => void;
}) {
  if (events.length === 0 || duration <= 0) {
    return null;
  }
  return (
    <div
      className="event-rail"
      role="group"
      aria-label={`Times ${label} was heard`}
    >
      {events.map((event, index) => {
        const left = Math.max(0, Math.min(100, (event.start_seconds / duration) * 100));
        const width = Math.max(
          0.7,
          Math.min(100 - left, ((event.end_seconds - event.start_seconds) / duration) * 100),
        );
        return (
          <button
            key={`${event.start_seconds}-${index}`}
            type="button"
            className="event-rail__event"
            style={{ left: `${left}%`, width: `${width}%` }}
            onClick={() => onSeek(event.start_seconds)}
            title={`Listen from ${formatDuration(event.start_seconds)} · match ${formatScore(event.model_score)}`}
            aria-label={`Listen from ${formatDuration(event.start_seconds)} to ${formatDuration(event.end_seconds)}, match ${formatScore(event.model_score)}`}
          />
        );
      })}
    </div>
  );
}

function ClassRow({
  item,
  duration,
  onSeek,
}: {
  item: AnalysisClass;
  duration: number;
  onSeek: (seconds: number) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <li className={`analysis-class${open ? " is-open" : ""}`}>
      <button
        type="button"
        className="analysis-class__summary"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
      >
        <ChevronDown
          size={15}
          className="analysis-class__chevron"
          aria-hidden="true"
        />
        <span className="analysis-class__label">{item.label}</span>
        <span className="analysis-class__bar" aria-hidden="true">
          <span style={{ width: `${item.detection_rate * 100}%` }} />
        </span>
        <span className="analysis-class__rate tabular">
          {formatPercent(item.detection_rate)}
        </span>
        <span className="analysis-class__windows tabular">
          {item.detected_windows}/{item.window_count} moments
        </span>
      </button>
      {open && (
        <div className="analysis-class__detail">
          <div className="analysis-class__metrics">
            <span>
              Strongest match <strong>{formatScore(item.peak_score)}</strong>
            </span>
            <span>
              Average match <strong>{formatScore(item.mean_score)}</strong>
            </span>
            <span>
              Times heard <strong>{item.events.length}</strong>
            </span>
          </div>
          <EventRail
            duration={duration}
            events={item.events}
            label={item.label}
            onSeek={onSeek}
          />
          {item.events.length > 0 ? (
            <div className="event-list">
              {item.events.slice(0, 10).map((event, index) => (
                <button
                  type="button"
                  className="event-list__item"
                  key={`${event.start_seconds}-${index}`}
                  onClick={() => onSeek(event.start_seconds)}
                  aria-label={`Listen to ${item.label} at ${formatDuration(event.start_seconds)}`}
                >
                  <span>{formatDuration(event.start_seconds)}</span>
                  <span className="event-list__span">
                    to {formatDuration(event.end_seconds)}
                  </span>
                  <span className="event-list__score">
                    match {formatScore(event.model_score)}
                  </span>
                </button>
              ))}
              {item.events.length > 10 && (
                <p className="event-list__more">
                  +{item.events.length - 10} more on the recording page
                </p>
              )}
            </div>
          ) : (
            <p className="event-rail__empty">No separate moment was saved.</p>
          )}
          <p className="analysis-class__hint">
            Selecting a time moves the player to that part of the recording. A match is a rough sign, not proof that the sound is there.
          </p>
        </div>
      )}
    </li>
  );
}

export function AnalysisClasses({
  classes,
  duration,
  threshold,
  onSeek,
}: {
  classes: AnalysisClass[];
  duration: number;
  threshold: number;
  onSeek: (seconds: number) => void;
}) {
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) {
      return classes;
    }
    return classes.filter((item) => item.label.toLowerCase().includes(needle));
  }, [classes, query]);

  const limit = 10;
  const visible = showAll ? filtered : filtered.slice(0, limit);

  if (classes.length === 0) {
    return (
      <div className="analysis-empty">
        <p className="eyebrow">No sounds found</p>
        <h3>The sound reader found no sounds at match level {threshold.toFixed(2)}.</h3>
        <p>
          The recording is still saved. You can try again with a lower match level.
        </p>
      </div>
    );
  }

  return (
    <div className="analysis-classes">
      <header className="analysis-classes__header">
        <div>
          <p className="eyebrow">Sounds found</p>
          <h2>What the sound reader heard</h2>
          <p>
            Every sound at the chosen match level, ordered by how often it was found.
          </p>
        </div>
        {classes.length > 8 && (
          <label className="search-field analysis-classes__search">
            <Search size={15} aria-hidden="true" />
            <input
              type="search"
              placeholder="Search sounds"
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
              aria-label="Search sounds"
            />
          </label>
        )}
      </header>

      <ul className="analysis-class-list">
        {visible.map((item) => (
          <ClassRow
            key={item.class_index}
            item={item}
            duration={duration}
            onSeek={onSeek}
          />
        ))}
      </ul>

      {filtered.length === 0 && (
        <p className="analysis-classes__none">
          No sound matches “{query}”.
        </p>
      )}

      {filtered.length > limit && (
        <button
          type="button"
          className="button button--ghost button--small"
          onClick={() => setShowAll((current) => !current)}
        >
          {showAll
            ? "Show fewer sounds"
            : `Show all ${filtered.length} sounds`}
        </button>
      )}
    </div>
  );
}
