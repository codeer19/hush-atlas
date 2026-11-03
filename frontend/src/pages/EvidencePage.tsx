import { Link, useParams } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  AudioLines,
  Download,
  MapPin,
  Search,
  TriangleAlert,
} from "lucide-react";
import { api } from "../api";
import type { ComparisonEvidence, EvidenceRecording } from "../types";
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
import {
  ClassificationBadge,
  DeltaDisplay,
  RateComparison,
} from "../components/ComparisonParts";
import { ReflectionPanel } from "../components/ReflectionPanel";
import { buildReflectionContext } from "../ondevice/prompt";

function EvidenceEventRail({
  evidence,
  duration,
}: {
  evidence: EvidenceRecording;
  duration: number;
}) {
  const events = evidence.recording.class_events ?? [];
  if (duration <= 0) {
    return null;
  }
  return (
    <div
      className="evidence-rail"
      aria-label={`Times this sound was heard in ${evidence.recording.title}`}
    >
      {events.length === 0 ? (
        <span className="evidence-rail__empty">
          This sound was not found in this recording.
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
              className="evidence-rail__event"
              key={`${event.start_seconds}-${index}`}
              style={{ left: `${left}%`, width: `${width}%` }}
              title={`${event.start_seconds.toFixed(2)}–${event.end_seconds.toFixed(
                2,
              )} s · match ${event.model_score.toFixed(2)}`}
            />
          );
        })
      )}
    </div>
  );
}

function EvidenceCard({
  evidence,
  label,
}: {
  evidence: EvidenceRecording;
  label: string;
}) {
  const recording = evidence.recording;
  const context = evidence.stop_context;
  return (
    <article className="evidence-card">
      <header className="evidence-card__head">
        <span className="badge badge--amber">{label}</span>
        <span className="tabular">
          {formatDuration(recording.duration_seconds)}
        </span>
      </header>
      <h3>{recording.title}</h3>
      <p className="evidence-card__meta">
        {formatDateTime(recording.recorded_at)}
        {context ? ` · ${context.stop_name}` : ""}
      </p>
      {context?.observation && (
        <blockquote className="evidence-card__observation">
          {context.observation}
        </blockquote>
      )}
      <audio controls preload="metadata" src={recording.audio_url}>
        Your browser does not support audio playback.
      </audio>
      {recording.waveform_peaks.length > 0 && (
        <div className="evidence-wave" aria-hidden="true">
          {samplePeaks(recording.waveform_peaks, 120).map((peak, index) => (
            <span
              key={index}
              style={{ height: `${Math.max(3, peak * 100)}%` }}
            />
          ))}
        </div>
      )}
      <EvidenceEventRail evidence={evidence} duration={recording.duration_seconds} />
      <div className="evidence-card__classes">
        {recording.top_classes.slice(0, 5).map((item) => (
          <span key={item.class_index}>
            {item.label}{" "}
            <small className="tabular">
              {formatPercent(item.detection_rate)}
            </small>
          </span>
        ))}
        {recording.top_classes.length === 0 && (
          <span className="evidence-card__muted">
            No sounds found.
          </span>
        )}
      </div>
      <div className="evidence-card__links">
        <Link to={`/recordings/${recording.id}/fingerprint`}>
          Sound details <ArrowRight size={13} aria-hidden="true" />
        </Link>
        {context && (
          <Link to={`/walks/${context.session_id}#stop-${context.stop_id}`}>
            <MapPin size={12} aria-hidden="true" /> This stop
          </Link>
        )}
      </div>
    </article>
  );
}

export function EvidencePage() {
  const params = useParams();
  const comparisonId = Number(params.comparisonId);
  const classIndex = Number(params.classIndex);
  const valid =
    Number.isInteger(comparisonId) &&
    comparisonId > 0 &&
    Number.isInteger(classIndex) &&
    classIndex >= 0;
  const evidence = useResource<ComparisonEvidence>(
    valid ? `evidence-${comparisonId}-${classIndex}` : "evidence-invalid",
    () => api.comparisonEvidence(comparisonId, classIndex),
  );
  useDocumentTitle(
    evidence.data ? `Sound · ${evidence.data.result.label}` : "Sound details",
  );

  if (!valid) {
    return (
      <div className="shell page">
        <ErrorPanel
          title="These details could not be opened"
          message="The address is not valid."
        />
      </div>
    );
  }

  if (evidence.loading && !evidence.data) {
    return (
      <div className="shell page">
        <LoadingPanel label="Opening the recordings" />
      </div>
    );
  }

  if (evidence.error && !evidence.data) {
    return (
      <div className="shell page">
        <ErrorPanel
          title="These details could not be opened"
          message={evidence.error}
          onRetry={evidence.refresh}
        />
      </div>
    );
  }

  if (!evidence.data) {
    return null;
  }

  const data = evidence.data;
  const result = data.result;
  const comparison = data.comparison;
  const baselineWindowCount = result.baseline_recording_rates.reduce(
    (total, item) => total + item.window_count,
    0,
  );
  const recentWindowCount = result.recent_recording_rates.reduce(
    (total, item) => total + item.window_count,
    0,
  );
  const baselinePeak = Math.max(
    0,
    ...result.baseline_recording_rates.map((item) => item.peak_score),
  );
  const recentPeak = Math.max(
    0,
    ...result.recent_recording_rates.map((item) => item.peak_score),
  );

  return (
    <div className="shell page evidence-page">
      <Breadcrumbs
        items={[
          { label: "My atlas", to: "/archive" },
          { label: "Compare", to: "/comparisons" },
          {
            label: "Comparison",
            to: `/comparisons/${comparison.id}`,
          },
          { label: result.label },
        ]}
      />

      <header className="evidence-header">
        <div>
          <p className="eyebrow">
            <Search size={13} aria-hidden="true" /> Sound details
          </p>
          <h1>{result.label}</h1>
          <p className="evidence-header__lede">
            The recordings behind this result. Rates show how often the sound was found; the audio is unchanged.
          </p>
          <div className="evidence-header__meta">
            <ClassificationBadge
              classification={result.classification}
              fading={result.fading}
            />
            <DeltaDisplay difference={result.difference_pp} />
            <span>
              {comparison.place_name} · match level{" "}
              {comparison.threshold.toFixed(2)}
            </span>
            {comparison.baseline_session_id && (
              <Link to={`/walks/${comparison.baseline_session_id}`}>
                Earlier walk
              </Link>
            )}
            {comparison.recent_session_id && (
              <Link to={`/walks/${comparison.recent_session_id}`}>
                Recent walk
              </Link>
            )}
          </div>
        </div>
        <div className="evidence-header__actions">
          <Link
            className="button button--ghost button--small"
            to={`/comparisons/${comparison.id}`}
          >
            <ArrowLeft size={14} aria-hidden="true" /> Back to comparison
          </Link>
          <a
            className="button button--ghost button--small"
            href={api.comparisonReportUrl(comparison.id, result.class_index)}
          >
            <Download size={14} aria-hidden="true" /> Download this sound
          </a>
        </div>
      </header>

      <section className="evidence-rates" aria-label="How often this sound was heard">
        <RateComparison
          baselineRate={result.baseline_rate}
          recentRate={result.recent_rate}
          baselineLabel={`Earlier · ${
            result.baseline_recording_rates.length
          } ${pluralize(
            result.baseline_recording_rates.length,
            "recording",
          )}`}
          recentLabel={`Recent · ${result.recent_recording_rates.length} ${pluralize(
            result.recent_recording_rates.length,
            "recording",
          )}`}
          large
        />
        <div className="evidence-rates__facts">
          <div>
            <span>Difference</span>
            <strong>
              <DeltaDisplay difference={result.difference_pp} showIcon={false} />
            </strong>
          </div>
          <div>
            <span>Times found</span>
            <strong className="tabular">
              {result.baseline_detected_windows} →{" "}
              {result.recent_detected_windows}
            </strong>
          </div>
          <div>
            <span>Total moments</span>
            <strong className="tabular">
              {baselineWindowCount} → {recentWindowCount}
            </strong>
          </div>
          <div>
            <span>Strongest match</span>
            <strong className="tabular">
              {formatScore(baselinePeak)} → {formatScore(recentPeak)}
            </strong>
          </div>
        </div>
      </section>

      <div className="evidence-layout">
        <div className="evidence-recordings">
          <section className="evidence-group" aria-labelledby="baseline-heading">
            <header className="hush-section__head">
              <div>
                <p className="eyebrow">Earlier</p>
                <h2 id="baseline-heading">Earlier recordings.</h2>
              </div>
              <span className="section-heading__count">
                {data.baseline_recordings.length}{" "}
                {pluralize(data.baseline_recordings.length, "clip")}
              </span>
            </header>
            <div className="evidence-card-grid">
              {data.baseline_recordings.map((item) => (
                <EvidenceCard
                  evidence={item}
                  label="Earlier"
                  key={item.recording.id}
                />
              ))}
            </div>
          </section>

          <section className="evidence-group" aria-labelledby="recent-heading">
            <header className="hush-section__head">
              <div>
                <p className="eyebrow">Recent</p>
                <h2 id="recent-heading">Recent recordings.</h2>
              </div>
              <span className="section-heading__count">
                {data.recent_recordings.length}{" "}
                {pluralize(data.recent_recordings.length, "clip")}
              </span>
            </header>
            <div className="evidence-card-grid">
              {data.recent_recordings.map((item) => (
                <EvidenceCard
                  evidence={item}
                  label="Recent"
                  key={item.recording.id}
                />
              ))}
            </div>
          </section>
        </div>

        <aside className="evidence-aside">
          <section className="evidence-method">
            <p className="eyebrow">How this works</p>
            <ul>
              {data.evidence_notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </section>

          <section className="fingerprint-warnings">
            <header>
              <TriangleAlert size={16} aria-hidden="true" />
              <h2>Keep in mind</h2>
            </header>
            <ul>
              {comparison.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
              {comparison.warnings.length === 0 && (
                <li>
                  A difference is not a cause. Microphone placement, gain,
                  weather, time of day and real environmental change can all
                  affect the evidence.
                </li>
              )}
            </ul>
          </section>

          <section className="evidence-stop-context">
            <p className="eyebrow">Walks</p>
            {comparison.stop_context.length === 0 ? (
              <p className="walk-aside__muted">
                These recordings are not part of a walk.
              </p>
            ) : (
              <ul>
                {comparison.stop_context.map((context) => (
                  <li key={`${context.session_id}-${context.stop_id}`}>
                    <Link to={`/walks/${context.session_id}#stop-${context.stop_id}`}>
                      <strong>{context.stop_name}</strong>
                      <small>
                        {context.session_title}
                        {context.observation ? ` · ${context.observation}` : ""}
                      </small>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <ReflectionPanel
            comparisonId={comparison.id}
            classIndex={result.class_index}
            label={result.label}
            context={buildReflectionContext(comparison, result)}
          />

          <section className="walk-aside__panel">
            <p className="eyebrow">Full report</p>
            <p className="walk-aside__muted">
              The full report lists every sound, recording, rate, and warning from this comparison.
            </p>
            <a
              className="text-link"
              href={api.comparisonReportUrl(comparison.id)}
            >
              <Download size={13} aria-hidden="true" /> Download full comparison
            </a>
          </section>

          <p className="evidence-audio-note">
            <AudioLines size={13} aria-hidden="true" /> Original audio only. No generated sounds, and no identified species.
          </p>
        </aside>
      </div>
    </div>
  );
}
