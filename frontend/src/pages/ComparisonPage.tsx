import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  Download,
  Search,
  SlidersHorizontal,
  TriangleAlert,
} from "lucide-react";
import { api } from "../api";
import type { ComparisonResult } from "../types";
import {
  classificationExplanation,
  classificationLabel,
  formatDate,
  formatDateTime,
  formatDuration,
  formatGroupDateRange,
  formatPercent,
  formatPp,
  formatScore,
  pluralize,
} from "../utils";
import { useDocumentTitle, useResource } from "../hooks";
import { Breadcrumbs, PageHeader } from "../components/PageHeader";
import { ErrorPanel, LoadingPanel } from "../components/States";
import {
  ClassificationBadge,
  DeltaDisplay,
  RateComparison,
} from "../components/ComparisonParts";
import { Badge } from "../components/StatusBadge";

type Filter =
  | "all"
  | "fading"
  | "detected_less"
  | "detected_more"
  | "newly_detected"
  | "similar";

const PAGE_SIZE = 20;

function ResultRow({
  result,
  placeId,
  comparisonId,
  fadingThreshold,
  changeThreshold,
  expanded,
  onToggle,
}: {
  result: ComparisonResult;
  placeId: number;
  comparisonId: number;
  fadingThreshold: number;
  changeThreshold: number;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <li className={`result-item${expanded ? " is-open" : ""}`}>
      <button
        type="button"
        className="result-row"
        onClick={onToggle}
        aria-expanded={expanded}
      >
        <span className="result-row__identity">
          <span className="result-row__label">{result.label}</span>
          <span className="result-row__tags">
            <ClassificationBadge
              classification={result.classification}
              fading={result.fading}
            />
            {result.notable && !result.fading && (
              <span className="result-row__notable">Changed</span>
            )}
          </span>
        </span>
        <span className="result-row__rates">
          <span>
            <small>Earlier</small>
            <strong className="tabular">{formatPercent(result.baseline_rate)}</strong>
            <span className="mini-track" aria-hidden="true">
              <span style={{ width: `${result.baseline_rate * 100}%` }} />
            </span>
          </span>
          <span>
            <small>Recent</small>
            <strong className="tabular">{formatPercent(result.recent_rate)}</strong>
            <span className="mini-track" aria-hidden="true">
              <span style={{ width: `${result.recent_rate * 100}%` }} />
            </span>
          </span>
        </span>
        <span className="result-row__delta">
          <DeltaDisplay difference={result.difference_pp} />
        </span>
        <ChevronDown
          size={16}
          className="result-row__chevron"
          aria-hidden="true"
        />
      </button>

      {expanded && (
        <div className="result-detail">
          <p className="result-detail__explanation">
            {classificationExplanation(result.classification, changeThreshold)}{" "}
            {result.fading
              ? `A sound is marked as fading when it was found in at least 5% of earlier moments and fell by at least ${fadingThreshold.toFixed(0)} points.`
              : "The size of the fall decides whether a decrease is marked as fading."}
          </p>
          <div className="evidence-columns">
            <section>
              <header>
                <span className="eyebrow">Earlier</span>
                <span>{result.baseline_recording_rates.length} {pluralize(result.baseline_recording_rates.length, "recording")}</span>
              </header>
              <ul className="rate-evidence">
                {result.baseline_recording_rates.map((item) => (
                  <li key={item.recording_id}>
                    <Link
                      to={`/places/${placeId}/recordings/${item.recording_id}`}
                    >
                      {item.title}
                    </Link>
                    <span className="rate-evidence__meta">
                      {formatDate(item.recorded_at)} ·{" "}
                      {formatDuration(item.duration_seconds)}
                    </span>
                    <span className="rate-evidence__numbers tabular">
                      {formatPercent(item.detection_rate)} ·{" "}
                      {item.detected_windows}/{item.window_count} moments · strongest{" "}
                      {formatScore(item.peak_score)}
                    </span>
                    {item.peak_window_start !== null && (
                      <span className="rate-evidence__peak">
                        Strongest moment {formatDuration(item.peak_window_start)} –{" "}
                        {formatDuration(item.peak_window_end ?? item.peak_window_start)}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </section>
            <section>
              <header>
                <span className="eyebrow">Recent</span>
                <span>{result.recent_recording_rates.length} {pluralize(result.recent_recording_rates.length, "recording")}</span>
              </header>
              <ul className="rate-evidence">
                {result.recent_recording_rates.map((item) => (
                  <li key={item.recording_id}>
                    <Link
                      to={`/places/${placeId}/recordings/${item.recording_id}`}
                    >
                      {item.title}
                    </Link>
                    <span className="rate-evidence__meta">
                      {formatDate(item.recorded_at)} ·{" "}
                      {formatDuration(item.duration_seconds)}
                    </span>
                    <span className="rate-evidence__numbers tabular">
                      {formatPercent(item.detection_rate)} ·{" "}
                      {item.detected_windows}/{item.window_count} moments · strongest{" "}
                      {formatScore(item.peak_score)}
                    </span>
                    {item.peak_window_start !== null && (
                      <span className="rate-evidence__peak">
                        Strongest moment {formatDuration(item.peak_window_start)} –{" "}
                        {formatDuration(item.peak_window_end ?? item.peak_window_start)}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          </div>
          <div className="result-detail__actions">
            <Link
              className="button button--primary button--small"
              to={`/comparisons/${comparisonId}/evidence/${result.class_index}`}
            >
              <Search size={14} aria-hidden="true" />
              See the recordings
            </Link>
            <span className="result-detail__source-note">
              Open the original recordings behind this result.
            </span>
          </div>
        </div>
      )}
    </li>
  );
}

export function ComparisonPage() {
  const params = useParams();
  const comparisonId = Number(params.comparisonId);
  const validId = Number.isInteger(comparisonId) && comparisonId > 0;
  const comparison = useResource(`comparison:${comparisonId}`, () =>
    api.comparison(comparisonId),
  );
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [expanded, setExpanded] = useState<number | null>(null);
  const data = comparison.data;

  useDocumentTitle(data ? `Compare ? ${data.place_name}` : "Compare");

  const filtered = useMemo(() => {
    if (!data) {
      return [];
    }
    const needle = query.trim().toLowerCase();
    return data.results.filter((result) => {
      if (needle && !result.label.toLowerCase().includes(needle)) {
        return false;
      }
      if (filter === "fading") {
        return result.fading;
      }
      if (filter !== "all") {
        return result.classification === filter;
      }
      return true;
    });
  }, [data, query, filter]);

  const visible = filtered.slice(0, limit);
  const fadingResults = data
    ? data.results.filter((result) => result.fading)
    : [];

  if (!validId) {
    return (
      <div className="shell page">
        <ErrorPanel
          title="This comparison could not be opened"
          message="The address is not valid."
        />
      </div>
    );
  }

  if (comparison.loading) {
    return (
      <div className="shell page">
        <LoadingPanel label="Opening the comparison" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="shell page">
        <Breadcrumbs
          items={[{ label: "My atlas", to: "/archive" }, { label: "Compare", to: "/comparisons" }, { label: "Comparison" }]}
        />
        <ErrorPanel
          title="This comparison could not be opened"
          message={comparison.error ?? "This comparison does not exist."}
          onRetry={comparison.refresh}
        />
      </div>
    );
  }

  return (
    <div className="shell page">
      <Breadcrumbs
        items={[
          { label: "Missions", to: "/" },
          { label: "Compare", to: "/comparisons" },
          { label: data.place_name, to: `/places/${data.place_id}` },
          { label: `No. ${data.id}` },
        ]}
      />

      <PageHeader
        eyebrow={`Comparison · ${formatDate(data.created_at)}`}
        title={
          <>
            {data.place_name},
            <br />
            then and now.
          </>
        }
        lede={
          <p>
            {data.baseline.recording_count}{" "}
            {pluralize(data.baseline.recording_count, "earlier recording")} from{" "}
            <strong>{formatGroupDateRange(data.baseline)}</strong> against{" "}
            {data.recent.recording_count}{" "}
            {pluralize(data.recent.recording_count, "recent recording")} from{" "}
            <strong>{formatGroupDateRange(data.recent)}</strong>.
          </p>
        }
        actions={
          <>
            <Link
              className="button button--ghost button--small"
              to={`/places/${data.place_id}`}
            >
              <ArrowLeft size={14} aria-hidden="true" />
              Place
            </Link>
            <Link
              className="button button--ghost button--small"
              to={`/places/${data.place_id}/compare`}
            >
              <SlidersHorizontal size={14} aria-hidden="true" />
              Compare again
            </Link>
            <a
              className="button button--ghost button--small"
              href={api.comparisonReportUrl(data.id)}
            >
              <Download size={14} aria-hidden="true" />
              Report
            </a>
          </>
        }
      />

      <section className="comparison-summary" aria-label="Comparison summary">
        <div className="comparison-summary__lead">
          <span className="eyebrow">Sounds compared</span>
          <strong className="tabular">{data.summary.class_count}</strong>
        </div>
        <div className="comparison-summary__fading">
          <span className="eyebrow">Fading</span>
          <strong className="tabular">{data.summary.fading_count}</strong>
        </div>
        <div>
          <span>New</span>
          <strong className="tabular">{data.summary.newly_detected_count}</strong>
        </div>
        <div>
          <span>Heard more</span>
          <strong className="tabular">{data.summary.detected_more_count}</strong>
        </div>
        <div>
          <span>Heard less</span>
          <strong className="tabular">{data.summary.detected_less_count}</strong>
        </div>
        <div>
          <span>About the same</span>
          <strong className="tabular">{data.summary.similar_count}</strong>
        </div>
      </section>

      <div className="comparison-meta">
        <span>
          Reliability:{" "}
          <strong>
            {data.reliability === "adequate" ? "Good" : "Limited"}
          </strong>
        </span>
        <span>
          Match level: <strong>{data.threshold.toFixed(2)}</strong>
        </span>
        <span>
          Change size: <strong>{data.change_threshold_pp.toFixed(0)} points</strong>
        </span>
        <span>
          Fading size: <strong>{data.fading_threshold_pp.toFixed(0)} points</strong>
        </span>
        <span>
          Saved {formatDateTime(data.created_at)}
        </span>
      </div>

      {data.warnings.length > 0 && (
        <section className="warning-panel" aria-labelledby="warnings-title">
          <header>
            <TriangleAlert size={17} aria-hidden="true" />
            <h2 id="warnings-title">Keep in mind</h2>
          </header>
          <ul>
            {data.warnings.map((warning, index) => (
              <li key={index}>{warning}</li>
            ))}
          </ul>
        </section>
      )}

      <section className="groups-panel" aria-labelledby="groups-title">
        <header className="section-heading">
          <div>
            <p className="eyebrow">What was compared</p>
            <h2 id="groups-title">Earlier and recent.</h2>
          </div>
          <span className={`reliability-badge reliability-badge--${data.reliability}`}>
            {data.reliability === "adequate"
              ? "Enough recordings"
              : "Few recordings"}
          </span>
        </header>
        <div className="group-columns">
          <div className="group-column group-column--baseline">
            <header>
              <span>Earlier</span>
              <strong>{formatGroupDateRange(data.baseline)}</strong>
              <small>
                {data.baseline.recording_count}{" "}
                {pluralize(data.baseline.recording_count, "recording")} ·{" "}
                {data.baseline.window_count.toLocaleString("en-GB")} moments
              </small>
            </header>
            <ul>
              {data.baseline.recordings.map((recording) => (
                <li key={recording.recording_id}>
                  <Link
                    to={`/places/${data.place_id}/recordings/${recording.recording_id}`}
                  >
                    {recording.title}
                  </Link>
                  <span>
                    {formatDate(recording.recorded_at)} ·{" "}
                    {formatDuration(recording.duration_seconds)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <div className="group-column group-column--recent">
            <header>
              <span>Recent</span>
              <strong>{formatGroupDateRange(data.recent)}</strong>
              <small>
                {data.recent.recording_count}{" "}
                {pluralize(data.recent.recording_count, "recording")} ·{" "}
                {data.recent.window_count.toLocaleString("en-GB")} moments
              </small>
            </header>
            <ul>
              {data.recent.recordings.map((recording) => (
                <li key={recording.recording_id}>
                  <Link
                    to={`/places/${data.place_id}/recordings/${recording.recording_id}`}
                  >
                    {recording.title}
                  </Link>
                  <span>
                    {formatDate(recording.recorded_at)} ·{" "}
                    {formatDuration(recording.duration_seconds)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section className="section fading-section" aria-labelledby="fading-title">
        <header className="section-heading">
          <div>
            <p className="eyebrow">Fading</p>
            <h2 id="fading-title">Sounds heard less often.</h2>
            <p className="section-heading__lede">
              These sounds were found less often by the chosen amount. Open one to see the recordings.
            </p>
          </div>
        </header>
        {fadingResults.length > 0 ? (
          <div className="fading-grid">
            {fadingResults.slice(0, 6).map((result) => (
              <Link
                key={result.class_index}
                className="fading-card"
                to={`/comparisons/${data.id}/evidence/${result.class_index}`}
              >
                <div className="fading-card__head">
                  <span className="badge badge--fading">
                    <Search size={12} aria-hidden="true" />
                    Details
                  </span>
                  <DeltaDisplay difference={result.difference_pp} />
                </div>
                <h3>{result.label}</h3>
                <RateComparison
                  baselineRate={result.baseline_rate}
                  recentRate={result.recent_rate}
                />
                <span className="fading-card__action">
                  See what changed{" "}
                  <ArrowRight size={14} aria-hidden="true" />
                </span>
              </Link>
            ))}
          </div>
        ) : (
          <p className="section-note">
            No sound was found less often by the chosen amount. The full list below still shows every difference.
          </p>
        )}
        {fadingResults.length > 6 && (
          <p className="section-note">
            Showing 6 of {fadingResults.length}. Use the list below to see the rest.
          </p>
        )}
      </section>

      <section className="section results-section" aria-labelledby="ledger-title">
        <header className="section-heading results-section__head">
          <div>
            <p className="eyebrow">Full list</p>
            <h2 id="ledger-title">Every sound compared.</h2>
            <p className="section-heading__lede">
              Rates show how often each sound was found in each group.
            </p>
          </div>
        </header>

        <div className="result-controls">
          <label className="search-field">
            <Search size={15} aria-hidden="true" />
            <input
              type="search"
              value={query}
              placeholder="Search sounds"
              aria-label="Search sounds"
              onChange={(event) => {
                setQuery(event.currentTarget.value);
                setLimit(PAGE_SIZE);
              }}
            />
          </label>
          <label className="select-field">
            <span className="visually-hidden">Filter sounds</span>
            <select
              value={filter}
              onChange={(event) => {
                setFilter(event.currentTarget.value as Filter);
                setLimit(PAGE_SIZE);
              }}
            >
              <option value="all">All sounds ({data.results.length})</option>
              <option value="fading">Fading ({data.summary.fading_count})</option>
              <option value="detected_less">
                Heard less ({data.summary.detected_less_count})
              </option>
              <option value="detected_more">
                Heard more ({data.summary.detected_more_count})
              </option>
              <option value="newly_detected">
                New ({data.summary.newly_detected_count})
              </option>
              <option value="similar">
                About the same ({data.summary.similar_count})
              </option>
            </select>
          </label>
          <span className="result-controls__count tabular">
            {filtered.length} {pluralize(filtered.length, "sound", "sounds")}
          </span>
        </div>

        {filtered.length === 0 ? (
          <p className="section-note">
            No sound matches this filter{query ? ` and “${query}”` : ""}.
          </p>
        ) : (
          <ul className="result-list">
            {visible.map((result) => (
              <ResultRow
                key={result.class_index}
                result={result}
                placeId={data.place_id}
                comparisonId={data.id}
                fadingThreshold={data.fading_threshold_pp}
                changeThreshold={data.change_threshold_pp}
                expanded={expanded === result.class_index}
                onToggle={() =>
                  setExpanded((current) =>
                    current === result.class_index ? null : result.class_index,
                  )
                }
              />
            ))}
          </ul>
        )}

        {filtered.length > visible.length && (
          <button
            type="button"
            className="button button--ghost"
            onClick={() => setLimit((current) => current + PAGE_SIZE)}
          >
            Show {Math.min(PAGE_SIZE, filtered.length - visible.length)} more
          </button>
        )}
      </section>

      <section className="comparison-method">
        <div>
          <p className="eyebrow">How to read this</p>
          <h2>A difference, not a verdict.</h2>
        </div>
        <div>
          <p>
            A rate is the share of moments in a recording where a sound was found. Group rates average the recordings. The difference is recent minus earlier, in points.
          </p>
          <p>
            Microphone, placement, weather, time of day, and what was recorded can all affect the result. A difference does not prove a sound has disappeared or explain why.
          </p>
        </div>
        <div className="comparison-method__meta">
          <span>Sound reader {data.model_name}</span>
          {data.model_version && <span>Version {data.model_version}</span>}
          <span>Saved {formatDateTime(data.created_at)}</span>
        </div>
      </section>

      <p className="comparison-footer-links">
        <Link className="text-link" to={`/places/${data.place_id}/map`}>
          Sound map for this place
        </Link>
        <span aria-hidden="true">·</span>
        <Link className="text-link" to="/comparisons">
          All comparisons
        </Link>
      </p>
    </div>
  );
}
