import { Link, useParams } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  AudioLines,
  Download,
  Fingerprint as FingerprintIcon,
  Gauge,
  MapPin,
  TriangleAlert,
  Waves,
} from "lucide-react";
import { api } from "../api";
import type { Fingerprint } from "../types";
import {
  formatDateTime,
  formatDuration,
  formatPercent,
  formatScore,
  pluralize,
} from "../utils";
import { useDocumentTitle, useResource } from "../hooks";
import { Breadcrumbs } from "../components/PageHeader";
import { ErrorPanel, LoadingPanel } from "../components/States";
import { samplePeaks } from "../components/Waveform";

export function FingerprintPage() {
  const params = useParams();
  const recordingId = Number(params.recordingId);
  const valid = Number.isInteger(recordingId) && recordingId > 0;
  const fingerprint = useResource<Fingerprint>(
    valid ? `fingerprint-${recordingId}` : "fingerprint-invalid",
    () => api.fingerprint(recordingId),
  );
  useDocumentTitle(
    fingerprint.data ? `Sound details · ${fingerprint.data.fingerprint.title}` : "Sound details",
  );

  if (!valid) {
    return (
      <div className="shell page">
        <ErrorPanel
          title="These sound details could not be opened"
          message="The address is not valid."
        />
      </div>
    );
  }

  if (fingerprint.loading && !fingerprint.data) {
    return (
      <div className="shell page">
        <LoadingPanel label="Opening the sound details" />
      </div>
    );
  }

  if (fingerprint.error && !fingerprint.data) {
    return (
      <div className="shell page">
        <ErrorPanel
          title="These sound details could not be opened"
          message={fingerprint.error}
          onRetry={fingerprint.refresh}
        />
      </div>
    );
  }

  if (!fingerprint.data) {
    return null;
  }

  const data = fingerprint.data;
  const summary = data.fingerprint;
  const context = data.stop_context;
  const run = data.analysis.analysis;
  const classes = run?.classes ?? [];

  return (
    <div className="shell page fingerprint-page">
      <Breadcrumbs
        items={[
          { label: "My atlas", to: "/archive" },
          {
            label: data.recording.place_name,
            to: `/places/${data.recording.place_id}`,
          },
          {
            label: data.recording.title,
            to: `/places/${data.recording.place_id}/recordings/${data.recording.id}`,
          },
          { label: "Sound details" },
        ]}
      />

      <header className="fingerprint-header">
        <div>
          <p className="eyebrow">
            <FingerprintIcon size={13} aria-hidden="true" /> Sound
            details
          </p>
          <h1>{summary.title}</h1>
          <p className="fingerprint-header__lede">
            {summary.place_name}
            {summary.stop_name ? ` · ${summary.stop_name}` : ""} ·{" "}
            {formatDateTime(summary.recorded_at)} ·{" "}
            {formatDuration(summary.duration_seconds)}
          </p>
          {context && (
            <div className="fingerprint-header__context">
              <Link to={`/walks/${context.session_id}`}>
                {context.session_title}
              </Link>
              {context.route_name && (
                <>
                  <span aria-hidden="true">·</span>
                  <Link to={`/routes/${context.route_id}`}>
                    {context.route_name}
                  </Link>
                </>
              )}
            </div>
          )}
        </div>
        <div className="fingerprint-header__actions">
          {context && (
            <Link
              className="button button--ghost button--small"
              to={`/walks/${context.session_id}#stop-${context.stop_id}`}
            >
              <ArrowLeft size={14} aria-hidden="true" /> Back to stop
            </Link>
          )}
          <Link
            className="button button--ghost button--small"
            to={`/places/${data.recording.place_id}/recordings/${data.recording.id}`}
          >
            Open recording <ArrowRight size={14} aria-hidden="true" />
          </Link>
        </div>
      </header>

      <div className="fingerprint-layout">
        <div className="fingerprint-main">
          <section className="fingerprint-player" aria-label="Original audio">
            <audio controls preload="metadata" src={summary.audio_url}>
              Your browser does not support audio playback.
            </audio>
            {summary.waveform_peaks.length > 0 && (
              <div className="fingerprint-wave" aria-hidden="true">
                {samplePeaks(summary.waveform_peaks, 120).map((peak, index) => (
                  <span
                    key={index}
                    style={{ height: `${Math.max(3, peak * 100)}%` }}
                  />
                ))}
              </div>
            )}
            <p>
              This is the original recording. The waveform and times come from the saved file, not a generated clip.
            </p>
          </section>

          <section className="fingerprint-classes" aria-labelledby="classes-heading">
            <header className="hush-section__head">
              <div>
                <p className="eyebrow">Sounds found</p>
                <h2 id="classes-heading">What was heard.</h2>
                <p className="hush-section__lede">
                  Each percentage is the share of moments where this sound was found. It is a rough guide, not a probability.
                </p>
              </div>
              <span className="section-heading__count">
                {classes.length}{" "}
                {pluralize(classes.length, "sound")}
              </span>
            </header>
            {data.analysis.status !== "completed" ? (
              <div className="fingerprint-status">
                <AudioLines size={20} aria-hidden="true" />
                <p>
                  {data.analysis.status === "failed"
                    ? "The result failed. The recording and its details are safe. Try again from the recording page."
                    : "These details will appear after the sound reader finishes."}
                </p>
              </div>
            ) : classes.length === 0 ? (
              <div className="fingerprint-status">
                <Waves size={20} aria-hidden="true" />
                <p>
                  The sound reader found no sounds at the chosen match level. This does not mean the place was silent.
                </p>
              </div>
            ) : (
              <ol className="fingerprint-class-list">
                {classes.map((item, index) => (
                  <li key={item.class_index}>
                    <span className="fingerprint-class__rank tabular">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <div className="fingerprint-class__main">
                      <div className="fingerprint-class__head">
                        <strong>{item.label}</strong>
                        <span className="tabular">
                          {formatPercent(item.detection_rate)}
                        </span>
                      </div>
                      <div className="fingerprint-class__bar" aria-hidden="true">
                        <span
                          style={{
                            width: `${Math.min(
                              100,
                              item.detection_rate * 100,
                            )}%`,
                          }}
                        />
                      </div>
                      <div className="fingerprint-class__meta tabular">
                        <span>
                          {item.detected_windows} / {item.window_count} moments
                        </span>
                        <span>strongest {formatScore(item.peak_score)}</span>
                        <span>{item.events.length} times</span>
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>

          <section className="fingerprint-warnings" aria-labelledby="limits-heading">
            <header>
              <TriangleAlert size={17} aria-hidden="true" />
              <h2 id="limits-heading">Keep in mind</h2>
            </header>
            <ul>
              {data.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </section>
        </div>

        <aside className="fingerprint-aside">
          <section className="walk-aside__panel">
            <p className="eyebrow">At a glance</p>
            <h2>Sound details.</h2>
            <dl className="fingerprint-facts">
              <div>
                <dt>
                  <Gauge size={13} aria-hidden="true" /> Sound reader
                </dt>
                <dd>
                  {summary.model_name ?? "Not analyzed"}
                  {summary.model_version ? ` · ${summary.model_version}` : ""}
                </dd>
              </div>
              <div>
                <dt>Moments</dt>
                <dd className="tabular">{summary.window_count}</dd>
              </div>
              <div>
                <dt>Match level</dt>
                <dd className="tabular">
                  {summary.threshold === null
                    ? "—"
                    : summary.threshold.toFixed(2)}
                </dd>
              </div>
              <div>
                <dt>Strongest match</dt>
                <dd className="tabular">{formatScore(summary.peak_score)}</dd>
              </div>
              <div>
                <dt>Sounds found</dt>
                <dd className="tabular">{summary.class_count}</dd>
              </div>
              <div>
                <dt>Times found</dt>
                <dd className="tabular">{summary.event_count}</dd>
              </div>
              <div>
                <dt>Duration</dt>
                <dd className="tabular">
                  {formatDuration(summary.duration_seconds)}
                </dd>
              </div>
            </dl>
          </section>

          {context && (
            <section className="walk-aside__panel">
              <p className="eyebrow">This stop</p>
              <h3>{context.stop_name}</h3>
              <p className="walk-aside__muted">
                {context.observation || "No note at this stop."}
              </p>
              <Link className="text-link" to={`/walks/${context.session_id}`}>
                Open the walk <ArrowRight size={13} aria-hidden="true" />
              </Link>
            </section>
          )}

          <section className="walk-aside__panel">
            <p className="eyebrow">Export</p>
            <h3>Take it with you.</h3>
            <p className="walk-aside__muted">
              Reports are plain text, generated from the saved result.
            </p>
            <Link
              className="text-link"
              to={`/places/${data.recording.place_id}/recordings/${data.recording.id}`}
            >
              <Download size={13} aria-hidden="true" /> Open recording
            </Link>
          </section>

          {context && (
            <p className="fingerprint-location">
              <MapPin size={13} aria-hidden="true" /> Stop{" "}
              {context.stop_order + 1} in {context.session_title}
            </p>
          )}
        </aside>
      </div>
    </div>
  );
}
