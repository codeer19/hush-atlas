import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  Clock3,
  Map as MapIcon,
  MousePointer2,
  Waves,
  X,
} from "lucide-react";
import { api } from "../api";
import type { AcousticMap, MapRecording, TopClass } from "../types";
import {
  formatCompactDate,
  formatDate,
  formatDuration,
  formatPercent,
  formatScore,
  pluralize,
  truncate,
} from "../utils";
import { useDocumentTitle, useMediaQuery, useResource } from "../hooks";
import { Breadcrumbs, PageHeader } from "../components/PageHeader";
import { EmptyState, ErrorPanel, LoadingPanel } from "../components/States";
import { Badge } from "../components/StatusBadge";

interface AggregateClass {
  class_index: number;
  label: string;
  total_rate: number;
  appearances: number;
  maximum_rate: number;
  maximum_peak: number;
}

interface MapSelection {
  recordingId: number;
  classIndex: number;
}

function classMapForRecording(recording: MapRecording): Map<number, TopClass> {
  return new Map(recording.top_classes.map((item) => [item.class_index, item]));
}

function selectionValue(selection: MapSelection | null): string {
  return selection ? String(selection.classIndex) : "";
}

export function SoundMapPage() {
  const params = useParams();
  const placeId = Number(params.placeId);
  const validId = Number.isInteger(placeId) && placeId > 0;
  const map = useResource(`map:${placeId}`, () => api.map(placeId));
  const [classFilter, setClassFilter] = useState<string>("");
  const [selection, setSelection] = useState<MapSelection | null>(null);
  const compact = useMediaQuery("(max-width: 600px)");
  const data = map.data;

  useDocumentTitle(data ? `Sound map · ${data.place_name}` : "Sound map");

  const aggregates = useMemo<AggregateClass[]>(() => {
    if (!data) {
      return [];
    }
    const collection = new Map<number, AggregateClass>();
    for (const recording of data.recordings) {
      for (const item of recording.top_classes) {
        const current = collection.get(item.class_index) ?? {
          class_index: item.class_index,
          label: item.label,
          total_rate: 0,
          appearances: 0,
          maximum_rate: 0,
          maximum_peak: 0,
        };
        current.total_rate += item.detection_rate;
        current.appearances += 1;
        current.maximum_rate = Math.max(current.maximum_rate, item.detection_rate);
        current.maximum_peak = Math.max(current.maximum_peak, item.peak_score);
        collection.set(item.class_index, current);
      }
    }
    return [...collection.values()].sort(
      (a, b) =>
        b.total_rate - a.total_rate ||
        b.appearances - a.appearances ||
        a.label.localeCompare(b.label),
    );
  }, [data]);

  const visibleClasses = useMemo(() => {
    if (classFilter) {
      return aggregates.filter(
        (item) => item.class_index === Number(classFilter),
      );
    }
    return aggregates.slice(0, 10);
  }, [aggregates, classFilter]);

  const selectedRecording = data?.recordings.find(
    (recording) => recording.recording_id === selection?.recordingId,
  );
  const selectedClass = data?.classes.find(
    (item) => item.class_index === selection?.classIndex,
  );
  const selectedTop = selectedRecording?.top_classes.find(
    (item) => item.class_index === selection?.classIndex,
  );
  const selectedEvents = selectedRecording?.events.filter(
    (event) => event.class_index === selection?.classIndex,
  ) ?? [];

  if (!validId) {
    return (
      <div className="shell page">
        <ErrorPanel
          title="This map could not be opened"
          message="The address is not valid."
        />
      </div>
    );
  }

  if (map.loading) {
    return (
      <div className="shell page">
        <LoadingPanel label="Opening the sound map" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="shell page">
        <Breadcrumbs
          items={[{ label: "My atlas", to: "/archive" }, { label: "Sound map" }]}
        />
        <ErrorPanel
          title="This sound map could not be opened"
          message={map.error ?? "This place does not exist."}
          onRetry={map.refresh}
        />
      </div>
    );
  }

  const analyzed = data.recordings.filter(
    (recording) => recording.analysis_status === "completed",
  ).length;
  const labelWidth = compact ? 108 : 164;
  const columnWidth = data.recordings.length > 8 ? 92 : compact ? 88 : 112;
  const topPad = 56;
  const rowHeight = 46;
  const bottomPad = 20;
  const chartWidth = Math.max(
    compact ? 300 : 760,
    labelWidth + data.recordings.length * columnWidth + 28,
  );
  const chartHeight =
    topPad + Math.max(1, visibleClasses.length) * rowHeight + bottomPad;
  const rowCenter = (index: number) => topPad + index * rowHeight + rowHeight / 2;
  const columnCenter = (index: number) =>
    labelWidth + index * columnWidth + columnWidth / 2;

  const selectedRate = selectedTop?.detection_rate ?? 0;
  const hasEvidence = analyzed > 0 && aggregates.length > 0;

  return (
    <div className="shell page sound-map-page">
      <Breadcrumbs
        items={[
          { label: "My atlas", to: "/archive" },
          { label: data.place_name, to: `/places/${data.place_id}` },
          { label: "Sound map" },
        ]}
      />

      {data.is_demo && (
        <div className="demo-note">
          <Badge tone="amber">Sample place</Badge>
          <p>
            This map uses the sample recordings. The results are real, but the place is made up.
          </p>
        </div>
      )}

      <PageHeader
        eyebrow={`Sound map · ${data.place_name}`}
        title="How sounds change over time."
        lede={
          <p>
            A map of the sounds found in this place&apos;s recordings. Bigger dots mean a sound was found more often. There is no geographic location here.
          </p>
        }
        actions={
          <>
            <Link
              className="button button--ghost button--small"
              to={`/places/${data.place_id}`}
            >
              <ArrowLeft size={14} aria-hidden="true" />
              Back to place
            </Link>
            {analyzed >= 2 && (
              <Link
                className="button button--ghost button--small"
                to={`/places/${data.place_id}/compare`}
              >
                <ArrowRight size={14} aria-hidden="true" />
                Compare
              </Link>
            )}
          </>
        }
      />

      <section className="map-stats" aria-label="Map summary">
        <div>
          <span>Recordings</span>
          <strong className="tabular">{data.recordings.length}</strong>
        </div>
        <div>
          <span>With results</span>
          <strong className="tabular">{analyzed}</strong>
        </div>
        <div>
          <span>Sounds</span>
          <strong className="tabular">{data.classes.length}</strong>
        </div>
        <div>
          <span>Dates</span>
          <strong>
            {data.recordings.length
              ? `${formatCompactDate(data.recordings[0].recorded_at)} – ${formatCompactDate(
                  data.recordings[data.recordings.length - 1].recorded_at,
                )}`
              : "—"}
          </strong>
        </div>
      </section>

      {!hasEvidence ? (
        <EmptyState
          icon={<MapIcon size={24} />}
          eyebrow="Nothing to map yet"
          title={
            analyzed === 0
              ? "No recordings with results yet."
              : "No sounds found."
          }
          body={
            <p>
              {analyzed === 0
                ? "Find the sounds in at least one recording. The map is built from those results."
                : "The recordings here had no sounds at the chosen match level. The map will stay empty until there are results."}
            </p>
          }
          action={
            <Link className="button button--primary" to={`/places/${data.place_id}`}>
              <ArrowLeft size={15} aria-hidden="true" />
              Back to place
            </Link>
          }
        />
      ) : (
        <>
          <div className="map-layout">
            <section className="map-card" aria-labelledby="map-title">
              <header className="map-card__head">
                <div>
                  <p className="eyebrow">Sounds over time</p>
                  <h2 id="map-title">The sound map</h2>
                </div>
                <label className="select-field map-card__filter">
                  <span>Sound</span>
                  <select
                    value={classFilter}
                    onChange={(event) => {
                      setClassFilter(event.currentTarget.value);
                      setSelection(null);
                    }}
                  >
                    <option value="">
                      Top 10 sounds
                    </option>
                    {aggregates.map((item) => (
                      <option value={item.class_index} key={item.class_index}>
                        {truncate(item.label, 42)}
                      </option>
                    ))}
                  </select>
                </label>
              </header>

              <div className="map-legend">
                <span>
                  <span className="map-legend__dot map-legend__dot--small" />
                  10% of moments
                </span>
                <span>
                  <span className="map-legend__dot map-legend__dot--medium" />
                  35%
                </span>
                <span>
                  <span className="map-legend__dot map-legend__dot--large" />
                  60%+
                </span>
                <span className="map-legend__note">
                  Bigger dots mean the sound was found more often.
                </span>
              </div>

              <div className="map-scroll">
                <svg
                  className="sound-map"
                  viewBox={`0 0 ${chartWidth} ${chartHeight}`}
                  style={{ minWidth: `${chartWidth}px` }}
                  role="group"
                  aria-label={`Sound map for ${data.place_name}. ${data.recordings.length} recordings across ${visibleClasses.length} sounds.`}
                >
                  <line
                    x1={labelWidth}
                    y1={topPad - 13}
                    x2={chartWidth - 20}
                    y2={topPad - 13}
                    className="sound-map__axis"
                  />
                  {data.recordings.map((recording, index) => {
                    const x = columnCenter(index);
                    const isSelectedColumn =
                      selection?.recordingId === recording.recording_id;
                    return (
                      <g key={recording.recording_id}>
                        {isSelectedColumn && (
                          <rect
                            x={x - columnWidth / 2 + 4}
                            y={topPad - 43}
                            width={columnWidth - 8}
                            height={chartHeight - topPad + 28}
                            className="sound-map__column-highlight"
                          />
                        )}
                        <line
                          x1={x}
                          y1={topPad - 10}
                          x2={x}
                          y2={chartHeight - 14}
                          className="sound-map__gridline"
                        />
                        <text
                          x={x}
                          y={16}
                          textAnchor="middle"
                          className="sound-map__date"
                        >
                          {formatCompactDate(recording.recorded_at)}
                        </text>
                        <text
                          x={x}
                          y={31}
                          textAnchor="middle"
                          className="sound-map__index"
                        >
                          {String(index + 1).padStart(2, "0")}
                        </text>
                      </g>
                    );
                  })}

                  {visibleClasses.map((item, rowIndex) => {
                    const y = rowCenter(rowIndex);
                    let previousX: number | null = null;
                    let previousY: number | null = null;
                    let previousRate = 0;
                    const cells = data.recordings.map((recording, index) => {
                      const top = classMapForRecording(recording).get(
                        item.class_index,
                      );
                      const x = columnCenter(index);
                      return { recording, top, x, index };
                    });
                    return (
                      <g key={item.class_index}>
                        <text
                          x={labelWidth - 14}
                          y={y + 4}
                          textAnchor="end"
                          className={`sound-map__label${
                            selection?.classIndex === item.class_index
                              ? " is-active"
                              : ""
                          }`}
                        >
                          {truncate(item.label, compact ? 14 : 23)}
                        </text>
                        {cells.map(({ top, x, index }) => {
                          if (!top || top.detection_rate <= 0) {
                            previousX = null;
                            previousY = null;
                            previousRate = 0;
                            return null;
                          }
                          let trail = null;
                          if (previousX !== null && previousY !== null) {
                            trail = (
                              <line
                                key={`trail-${index}`}
                                x1={previousX}
                                y1={previousY}
                                x2={x}
                                y2={y}
                                className="sound-map__trail"
                                opacity={0.2 + Math.min(previousRate, top.detection_rate) * 0.65}
                              />
                            );
                          }
                          previousX = x;
                          previousY = y;
                          previousRate = top.detection_rate;
                          return trail;
                        })}
                        {cells.map(({ recording, top, x }) => {
                          if (!top) {
                            return null;
                          }
                          const radius =
                            top.detection_rate > 0
                              ? 3.2 + Math.min(1, top.detection_rate) * 10.5
                              : 2.5;
                          const active =
                            selection?.recordingId === recording.recording_id &&
                            selection.classIndex === item.class_index;
                          return (
                            <g
                              key={`${item.class_index}-${recording.recording_id}`}
                              className={`map-dot${active ? " is-active" : ""}`}
                              tabIndex={0}
                              role="button"
                              aria-label={`${item.label} in ${recording.title}, ${formatCompactDate(recording.recorded_at)}: found in ${formatPercent(top.detection_rate)} of moments. Open details.`}
                              onClick={() =>
                                setSelection({
                                  recordingId: recording.recording_id,
                                  classIndex: item.class_index,
                                })
                              }
                              onKeyDown={(event) => {
                                if (event.key === "Enter" || event.key === " ") {
                                  event.preventDefault();
                                  setSelection({
                                    recordingId: recording.recording_id,
                                    classIndex: item.class_index,
                                  });
                                }
                              }}
                            >
                              <title>
                                {item.label} · {recording.title} ·{" "}
                                {formatPercent(top.detection_rate)} of moments
                              </title>
                              <circle
                                cx={x}
                                cy={y}
                                r={Math.max(20, radius + 8)}
                                className="map-dot__hit"
                              />
                              <circle
                                cx={x}
                                cy={y}
                                r={radius + 5}
                                className="map-dot__halo"
                              />
                              <circle
                                cx={x}
                                cy={y}
                                r={radius}
                                className="map-dot__core"
                                opacity={
                                  top.detection_rate > 0
                                    ? 0.35 + Math.min(1, top.detection_rate) * 0.65
                                    : 0.2
                                }
                              />
                              {top.peak_score >= 0.5 && (
                                <circle
                                  cx={x}
                                  cy={y}
                                  r={Math.max(1.2, radius * 0.28)}
                                  className="map-dot__peak"
                                />
                              )}
                            </g>
                          );
                        })}
                      </g>
                    );
                  })}

                  {visibleClasses.length === 0 && (
                    <text
                      x={chartWidth / 2}
                      y={topPad + 50}
                      textAnchor="middle"
                      className="sound-map__empty"
                    >
                      No sound matches this filter.
                    </text>
                  )}
                </svg>
              </div>
              <p className="map-card__caption">
                Each column is a recording, oldest to newest. Dots show how often a sound was found. A missing dot means it was not in that recording&apos;s top sounds; it does not prove absence.
              </p>
              <p className="map-card__note">{data.note}</p>
            </section>

            <aside className="map-inspector" aria-live="polite">
              {selection && selectedRecording && selectedClass ? (
                <>
                  <header className="map-inspector__head">
                    <div>
                      <p className="eyebrow">Selected sound</p>
                      <h2>{selectedClass.label}</h2>
                    </div>
                    <button
                      type="button"
                      className="icon-button"
                      aria-label="Clear selection"
                      onClick={() => setSelection(null)}
                    >
                      <X size={16} />
                    </button>
                  </header>
                  <dl className="map-inspector__facts">
                    <div>
                      <dt>Found in</dt>
                      <dd className="tabular">{formatPercent(selectedRate)}</dd>
                    </div>
                    <div>
                      <dt>Strongest match</dt>
                      <dd className="tabular">
                        {formatScore(selectedTop?.peak_score ?? 0)}
                      </dd>
                    </div>
                    <div>
                      <dt>Times heard</dt>
                      <dd className="tabular">{selectedEvents.length}</dd>
                    </div>
                  </dl>
                  <div className="map-inspector__recording">
                    <span>Recording</span>
                    <Link
                      to={`/places/${data.place_id}/recordings/${selectedRecording.recording_id}`}
                    >
                      {selectedRecording.title}
                    </Link>
                    <span>
                      {formatDate(selectedRecording.recorded_at)} ·{" "}
                      {formatDuration(selectedRecording.duration_seconds)}
                    </span>
                  </div>
                  {selectedEvents.length > 0 && (
                    <div className="map-inspector__events">
                      <span>When</span>
                      <ul>
                        {selectedEvents.slice(0, 6).map((event, index) => (
                          <li key={`${event.start_seconds}-${index}`}>
                            <Clock3 size={12} aria-hidden="true" />
                            {formatDuration(event.start_seconds)} –{" "}
                            {formatDuration(event.end_seconds)}
                            <span className="tabular">
                              match {formatScore(event.model_score)}
                            </span>
                          </li>
                        ))}
                      </ul>
                      {selectedEvents.length > 6 && (
                        <small>
                          +{selectedEvents.length - 6} more on the recording
                          page
                        </small>
                      )}
                    </div>
                  )}
                  <Link
                    className="button button--primary button--small"
                    to={`/places/${data.place_id}/recordings/${selectedRecording.recording_id}`}
                  >
                    <Waves size={14} aria-hidden="true" />
                    Open and listen
                  </Link>
                </>
              ) : (
                <>
                  <header>
                    <p className="eyebrow">Explore the map</p>
                    <h2>Choose a dot.</h2>
                  </header>
                  <p>
                    Select a dot to see how often the sound was found and when. Use Tab and Enter to explore without a mouse.
                  </p>
                  <div className="map-inspector__empty-mark" aria-hidden="true">
                    <MousePointer2 size={22} />
                  </div>
                  <p className="map-inspector__hint">
                    The map shows the top sounds in each recording. A sound that is missing may still have been found below the top 12. The full result stays on each recording.
                  </p>
                </>
              )}
            </aside>
          </div>

          <details className="map-table">
            <summary>View as a table</summary>
            <div className="map-table__scroll">
              <table>
                <caption>
                  How often each sound was found
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Sound</th>
                    {data.recordings.map((recording) => (
                      <th scope="col" key={recording.recording_id}>
                        <Link
                          to={`/places/${data.place_id}/recordings/${recording.recording_id}`}
                        >
                          {formatCompactDate(recording.recorded_at)}
                        </Link>
                        <span>{recording.title}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visibleClasses.map((item) => (
                    <tr key={item.class_index}>
                      <th scope="row">{item.label}</th>
                      {data.recordings.map((recording) => {
                        const top = recording.top_classes.find(
                          (entry) => entry.class_index === item.class_index,
                        );
                        return (
                          <td key={recording.recording_id}>
                            {top ? formatPercent(top.detection_rate) : "—"}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>

          <section className="map-method">
            <div>
              <p className="eyebrow">What this is</p>
              <h2>A map of time, not place.</h2>
            </div>
            <div>
              <p>
                This map has no geography. Across is time, and each row is a sound. It shows when sounds cluster, thin out, or persist.
              </p>
              <p>
                {aggregates.length}{" "}
                {pluralize(aggregates.length, "sound")} appear in the saved results. The map starts with the ten most common; use the menu to see any one sound.
              </p>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
