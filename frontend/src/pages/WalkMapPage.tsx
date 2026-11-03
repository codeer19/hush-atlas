import { useMemo, useState, type CSSProperties } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  AudioLines,
  Download,
  Filter,
  MapPin,
  Route as RouteIcon,
  Waves,
} from "lucide-react";
import { api } from "../api";
import type { WalkMap, WalkMapStop } from "../types";
import {
  formatDateTime,
  formatDuration,
  formatPercent,
  pluralize,
} from "../utils";
import { useDocumentTitle, useResource } from "../hooks";
import { Breadcrumbs } from "../components/PageHeader";
import { ErrorPanel, LoadingPanel } from "../components/States";
import { StatusBadge } from "../components/StatusBadge";
import { samplePeaks } from "../components/Waveform";

function classHue(index: number): number {
  return (index * 47 + 28) % 360;
}

function coordinatesFor(
  stops: WalkMapStop[],
): Array<{ x: number; y: number }> {
  const located = stops.filter(
    (stop) => stop.latitude !== null && stop.longitude !== null,
  );
  if (located.length !== stops.length) {
    return stops.map((_, index) => {
      const width = 840;
      const left = 80;
      const usable = width - left * 2;
      const step = stops.length > 1 ? usable / (stops.length - 1) : 0;
      return {
        x: stops.length > 1 ? left + index * step : width / 2,
        y: 210 + (index % 2 === 0 ? -66 : 66),
      };
    });
  }
  const lats = stops.map((stop) => stop.latitude as number);
  const lons = stops.map((stop) => stop.longitude as number);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);
  const latSpan = maxLat - minLat || 1;
  const lonSpan = maxLon - minLon || 1;
  return stops.map((stop) => {
    const x = 90 + (((stop.longitude as number) - minLon) / lonSpan) * 660;
    const y = 330 - (((stop.latitude as number) - minLat) / latSpan) * 240;
    return { x, y };
  });
}

function RouteDiagram({
  walk,
  selectedClass,
  onSelect,
}: {
  walk: WalkMap;
  selectedClass: number | null;
  onSelect: (index: number | null) => void;
}) {
  const points = useMemo(() => coordinatesFor(walk.stops), [walk.stops]);
  const path = points
    .map((point, index) => `${index === 0 ? "M" : "L"}${point.x} ${point.y}`)
    .join(" ");

  return (
    <div className="route-diagram">
      <div className="route-diagram__canvas">
        <svg
          viewBox="0 0 840 420"
          role="img"
          aria-label={
            walk.has_coordinates
              ? "Route sketch from saved stop locations."
              : "Stops shown in walking order."
          }
        >
          <defs>
            <pattern
              id="route-grid"
              width="42"
              height="42"
              patternUnits="userSpaceOnUse"
            >
              <path
                d="M 42 0 L 0 0 0 42"
                fill="none"
                stroke="rgba(22,35,15,0.08)"
                strokeWidth="1"
              />
            </pattern>
          </defs>
          <rect width="840" height="420" fill="url(#route-grid)" />
          <path
            d={path}
            fill="none"
            stroke="rgba(82,103,73,0.45)"
            strokeWidth="2"
            strokeDasharray="6 7"
          />
          {walk.stops.map((stop, index) => {
            const point = points[index];
            const hasSelected =
              selectedClass === null
                ? stop.events.length > 0
                : stop.events.some(
                    (event) => event.class_index === selectedClass,
                  );
            const eventCount =
              selectedClass === null
                ? stop.events.length
                : stop.events.filter(
                    (event) => event.class_index === selectedClass,
                  ).length;
            return (
              <g
                className={`route-node${
                  hasSelected ? " has-events" : ""
                }${stop.recording ? " has-recording" : ""}`}
                key={stop.id}
                transform={`translate(${point.x} ${point.y})`}
              >
                <circle r="28" className="route-node__halo" />
                <circle r="17" className="route-node__ring" />
                <text
                  textAnchor="middle"
                  dominantBaseline="central"
                  className="route-node__number"
                >
                  {String(index + 1).padStart(2, "0")}
                </text>
                <text
                  textAnchor="middle"
                  y="40"
                  className="route-node__label"
                >
                  {stop.name.length > 24
                    ? `${stop.name.slice(0, 23)}…`
                    : stop.name}
                </text>
                {eventCount > 0 && (
                  <text
                    textAnchor="middle"
                    y="-30"
                    className="route-node__count"
                  >
                    {eventCount} event{eventCount === 1 ? "" : "s"}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>

      <div className="route-legend">
        <div className="route-legend__head">
          <Filter size={14} aria-hidden="true" />
          <span>
            {walk.classes.length > 0
              ? "Filter sounds"
              : "No results yet"}
          </span>
          {selectedClass !== null && (
            <button
              type="button"
              className="text-link text-link--button"
              onClick={() => onSelect(null)}
            >
              Clear
            </button>
          )}
        </div>
        {walk.classes.length > 0 && (
          <div className="route-legend__classes">
            <button
              type="button"
              className={`class-chip${selectedClass === null ? " is-active" : ""}`}
              onClick={() => onSelect(null)}
            >
              <Waves size={12} aria-hidden="true" /> All sounds
            </button>
            {walk.classes.map((item) => (
              <button
                type="button"
                key={item.class_index}
                className={`class-chip${
                  selectedClass === item.class_index ? " is-active" : ""
                }`}
                onClick={() =>
                  onSelect(
                    selectedClass === item.class_index
                      ? null
                      : item.class_index,
                  )
                }
                style={
                  {
                    "--chip-color": `hsl(${classHue(item.class_index)} 42% 62%)`,
                  } as CSSProperties
                }
              >
                <span className="class-chip__dot" aria-hidden="true" />
                {item.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function EventRail({
  stop,
  selectedClass,
}: {
  stop: WalkMapStop;
  selectedClass: number | null;
}) {
  if (!stop.recording || stop.recording.duration_seconds <= 0) {
    return null;
  }
  const events =
    selectedClass === null
      ? stop.events
      : stop.events.filter((event) => event.class_index === selectedClass);
  const duration = stop.recording.duration_seconds;
  return (
    <div
      className="map-event-rail"
      aria-label={`Sounds across ${formatDuration(duration)}`}
    >
      {events.length === 0 ? (
        <span className="map-event-rail__empty">
          {selectedClass === null
            ? "No sounds found in this clip."
            : "This sound was not found in this clip."}
        </span>
      ) : (
        events.map((event, index) => {
          const left = Math.max(
            0,
            Math.min(100, (event.start_seconds / duration) * 100),
          );
          const width = Math.max(
            0.8,
            Math.min(
              100 - left,
              ((event.end_seconds - event.start_seconds) / duration) * 100,
            ),
          );
          return (
            <span
              className="map-event"
              key={`${event.class_index}-${event.start_seconds}-${index}`}
              style={{
                left: `${left}%`,
                width: `${width}%`,
                background:
                  selectedClass === null
                    ? `hsla(${classHue(event.class_index)}, 42%, 62%, 0.68)`
                    : `hsl(${classHue(event.class_index)} 42% 62%)`,
              }}
              title={`${event.label}: ${event.start_seconds.toFixed(
                2,
              )}–${event.end_seconds.toFixed(2)} s, match ${event.model_score.toFixed(
                2,
              )}`}
            />
          );
        })
      )}
    </div>
  );
}

function MapStopCard({
  stop,
  selectedClass,
}: {
  stop: WalkMapStop;
  selectedClass: number | null;
}) {
  const recording = stop.recording;
  const filteredClasses = recording
    ? selectedClass === null
      ? recording.top_classes
      : recording.top_classes.filter(
          (item) => item.class_index === selectedClass,
        )
    : [];
  return (
    <article className="map-stop-card" id={`map-stop-${stop.id}`}>
      <header className="map-stop-card__head">
        <span className="map-stop-card__number tabular">
          {String(stop.stop_order + 1).padStart(2, "0")}
        </span>
        <div>
          <h3>{stop.name}</h3>
          <StatusBadge status={stop.status} kind="stop" compact />
        </div>
        {recording && (
          <Link
            className="text-link"
            to={`/recordings/${recording.id}/fingerprint`}
          >
            Sound details
          </Link>
        )}
      </header>

      {stop.observation ? (
        <blockquote className="map-stop-card__observation">
          {stop.observation}
        </blockquote>
      ) : (
        <p className="map-stop-card__muted">No note here.</p>
      )}

      {recording ? (
        <>
          <div className="map-stop-card__audio">
            <audio controls preload="metadata" src={recording.audio_url}>
              Your browser does not support audio playback.
            </audio>
            <span className="tabular">
              {formatDuration(recording.duration_seconds)}
            </span>
          </div>
          {stop.waveform.length > 0 && (
            <div className="map-waveform" aria-hidden="true">
              {samplePeaks(stop.waveform, 96).map((peak, index) => (
                <span
                  key={index}
                  style={{ height: `${Math.max(4, peak * 100)}%` }}
                />
              ))}
            </div>
          )}
          <EventRail stop={stop} selectedClass={selectedClass} />
          <div className="map-stop-card__classes">
            {filteredClasses.length === 0 ? (
              <span className="map-stop-card__muted">
                {selectedClass === null
                  ? "No sounds found."
                  : "This sound was not found."}
              </span>
            ) : (
              filteredClasses.slice(0, 8).map((item) => (
                <span className="map-class" key={item.class_index}>
                  <span
                    className="map-class__dot"
                    style={{
                      background: `hsl(${classHue(item.class_index)} 42% 62%)`,
                    }}
                    aria-hidden="true"
                  />
                  {item.label}
                  <small className="tabular">
                    {formatPercent(item.detection_rate)}
                  </small>
                </span>
              ))
            )}
          </div>
          <div className="map-stop-card__links">
            <Link to={`/recordings/${recording.id}`}>
              Open sound <ArrowRight size={13} aria-hidden="true" />
            </Link>
            <Link to={`/walks/${stop.session_id}#stop-${stop.id}`}>
              Back to this stop <ArrowRight size={13} aria-hidden="true" />
            </Link>
          </div>
        </>
      ) : (
        <p className="map-stop-card__muted">
          No recording at this stop.
        </p>
      )}
    </article>
  );
}

export function WalkMapPage() {
  const params = useParams();
  const sessionId = Number(params.sessionId);
  const valid = Number.isInteger(sessionId) && sessionId > 0;
  const map = useResource<WalkMap>(
    valid ? `walk-map-${sessionId}` : "walk-map-invalid",
    () => api.walkMap(sessionId),
  );
  const [selectedClass, setSelectedClass] = useState<number | null>(null);
  useDocumentTitle(map.data ? `${map.data.title} ? Sound map` : "Sound map");

  if (!valid) {
    return (
      <div className="shell page">
        <ErrorPanel
          title="This map could not be opened"
          message="The walk address is not valid."
        />
      </div>
    );
  }

  if (map.loading && !map.data) {
    return (
      <div className="shell page">
        <LoadingPanel label="Opening the sound map" />
      </div>
    );
  }

  if (map.error && !map.data) {
    return (
      <div className="shell page">
        <ErrorPanel
          title="This map could not be opened"
          message={map.error}
          onRetry={map.refresh}
        />
      </div>
    );
  }

  if (!map.data) {
    return null;
  }

  const data = map.data;

  return (
    <div className="shell page map-page">
      <Breadcrumbs
        items={[
          { label: "Missions", to: "/" },
          { label: "My atlas", to: "/archive" },
          { label: data.title, to: `/walks/${data.session_id}` },
          { label: "Sound map" },
        ]}
      />

      <header className="map-page__header">
        <div>
          <p className="eyebrow">
            {data.mission_title} · {data.place_name}
          </p>
          <h1>{data.title}</h1>
          <p className="map-page__lede">
            {data.route_name ? `${data.route_name} ? ` : ""}
            {data.progress.recorded_stops} of {data.progress.total_stops} stops recorded. Started {formatDateTime(data.started_at)}.
          </p>
        </div>
        <div className="map-page__actions">
          <Link
            className="button button--ghost button--small"
            to={`/walks/${data.session_id}`}
          >
            <ArrowLeft size={14} aria-hidden="true" /> Back to walk
          </Link>
          <a
            className="button button--ghost button--small"
            href={api.walkReportUrl(data.session_id)}
          >
            <Download size={14} aria-hidden="true" /> Report
          </a>
        </div>
      </header>

      <div className="map-layout">
        <div className="map-main">
          <RouteDiagram
            walk={data}
            selectedClass={selectedClass}
            onSelect={setSelectedClass}
          />
          <p className="map-note">
            <MapPin size={14} aria-hidden="true" /> {data.note}
          </p>
        </div>

        <aside className="map-aside">
          <div className="map-aside__stat">
            <span>Stops</span>
            <strong className="tabular">{data.progress.total_stops}</strong>
          </div>
          <div className="map-aside__stat">
            <span>Results</span>
            <strong className="tabular">{data.progress.analyzed_stops}</strong>
          </div>
          <div className="map-aside__stat">
            <span>Sounds found</span>
            <strong className="tabular">{data.classes.length}</strong>
          </div>
          <div className="map-aside__stat">
            <span>Listening time</span>
            <strong className="tabular">
              {formatDuration(
                data.stops.reduce(
                  (total, stop) => total + (stop.recording?.duration_seconds ?? 0),
                  0,
                ),
              )}
            </strong>
          </div>
          <div className="map-aside__routes">
            <RouteIcon size={16} aria-hidden="true" />
            <p>
              {data.has_coordinates
                ? "Stops use saved locations. No map tiles are used."
                : "Stops are shown in walking order. No locations were saved."}
            </p>
          </div>
          <Link className="text-link" to={`/walks/${data.session_id}`}>
            {data.status === "completed"
              ? "Open this walk"
              : "Continue this walk"}{" "}
            <ArrowRight size={14} aria-hidden="true" />
          </Link>
        </aside>
      </div>

      <section className="map-sounds" aria-labelledby="sounds-heading">
        <header className="hush-section__head">
          <div>
            <p className="eyebrow">Along the walk</p>
            <h2 id="sounds-heading">Stops and sounds.</h2>
            <p className="hush-section__lede">
              Each rail shows when a sound was heard in the original recording. It does not prove the source.
            </p>
          </div>
          <span className="section-heading__count">
            {data.stops.length}{" "}
            {pluralize(data.stops.length, "stop")}
          </span>
        </header>

        {data.stops.length === 0 ? (
          <div className="mini-empty">
            <AudioLines size={20} aria-hidden="true" />
            <p>This walk has no stops.</p>
          </div>
        ) : (
          <div className="map-stop-grid">
            {data.stops.map((stop) => (
              <MapStopCard
                stop={stop}
                selectedClass={selectedClass}
                key={stop.id}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
