import { useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  Copy,
  Printer,
  TriangleAlert,
} from "lucide-react";
import { api } from "../api";
import {
  buildObituaryCopy,
  formatDate,
  formatDateTime,
  formatDuration,
  formatGroupDateRange,
  formatPercent,
  formatScore,
  pluralize,
} from "../utils";
import { useCopyToClipboard, useDocumentTitle, useResource } from "../hooks";
import { Breadcrumbs } from "../components/PageHeader";
import { ErrorPanel, LoadingPanel } from "../components/States";
import {
  ClassificationBadge,
  DeltaDisplay,
  RateComparison,
} from "../components/ComparisonParts";
import { ReflectionPanel } from "../components/ReflectionPanel";
import { useToast } from "../components/Toast";
import { buildReflectionContext } from "../ondevice/prompt";

export function ObituaryPage() {
  const params = useParams();
  const comparisonId = Number(params.comparisonId);
  const classIndex = Number(params.classIndex);
  const valid =
    Number.isInteger(comparisonId) &&
    comparisonId > 0 &&
    Number.isInteger(classIndex) &&
    classIndex >= 0;
  const comparison = useResource(`comparison:${comparisonId}`, () =>
    api.comparison(comparisonId),
  );
  const { copied, copy } = useCopyToClipboard();
  const { push } = useToast();
  const data = comparison.data;
  const result = useMemo(
    () =>
      data?.results.find((item) => item.class_index === classIndex) ?? null,
    [data, classIndex],
  );
  const fadingResults = useMemo(
    () => data?.results.filter((item) => item.fading) ?? [],
    [data],
  );

  useDocumentTitle(
    result
      ? `${result.label} · ${result.fading ? "Heard less" : "Sound reading"}`
      : "Sound reading",
  );

  if (!valid) {
    return (
      <div className="shell page">
        <ErrorPanel
          title="This reading could not be opened"
          message="The address is not valid."
        />
      </div>
    );
  }

  if (comparison.loading) {
    return (
      <div className="shell page">
        <LoadingPanel label="Opening the reading" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="shell page">
        <Breadcrumbs
          items={[
            { label: "My atlas", to: "/archive" },
            { label: "Compare", to: "/comparisons" },
            { label: "Sound reading" },
          ]}
        />
        <ErrorPanel
          title="This comparison could not be opened"
          message={comparison.error ?? "This comparison does not exist."}
          onRetry={comparison.refresh}
        />
      </div>
    );
  }

  if (!result) {
    return (
      <div className="shell page">
        <Breadcrumbs
          items={[
            { label: "My atlas", to: "/archive" },
            { label: "Comparisons", to: "/comparisons" },
            { label: "Comparison", to: `/comparisons/${data.id}` },
            { label: "Sound reading" },
          ]}
        />
        <ErrorPanel
          title="This sound is not in the comparison"
          message="This comparison has no result for that sound. Go back and choose one that was found."
        />
        <Link className="text-link" to={`/comparisons/${data.id}`}>
          Back to comparison
        </Link>
      </div>
    );
  }

  const fading = result.fading;
  const currentFadingIndex = fadingResults.findIndex(
    (item) => item.class_index === result.class_index,
  );
  const previous =
    currentFadingIndex > 0 ? fadingResults[currentFadingIndex - 1] : null;
  const next =
    currentFadingIndex >= 0 && currentFadingIndex < fadingResults.length - 1
      ? fadingResults[currentFadingIndex + 1]
      : null;

  const copyEvidence = async () => {
    const success = await copy(buildObituaryCopy(data, result));
    if (!success) {
      push("This text could not be copied.", "error");
    }
  };

  return (
    <div className="shell page obituary-page">
      <Breadcrumbs
        items={[
          { label: "My atlas", to: "/archive" },
          { label: "Compare", to: "/comparisons" },
          { label: data.place_name, to: `/places/${data.place_id}` },
          {
            label: "Comparison",
            to: `/comparisons/${data.id}`,
          },
          { label: fading ? "Heard less" : "Sound reading" },
        ]}
      />

      <article className="obituary">
        <header className="obituary-hero">
          <div className="obituary-hero__copy">
            <p className="eyebrow">
              {fading
                ? "A sound heard less often"
                : "A sound in this comparison"}
            </p>
            <div className="obituary-hero__title">
              <span className="obituary-hero__rule" aria-hidden="true" />
              <h1>{result.label}</h1>
            </div>
            <p className="obituary-hero__dedication">
              A sound in <Link to={`/places/${data.place_id}`}>{data.place_name}</Link>,
              read on {formatDate(data.created_at)}.
            </p>
            <p className="obituary-hero__lede">
              {fading ? (
                <>
                  The sound reader found this sound in{" "}
                  <strong>{formatPercent(result.baseline_rate)}</strong> of the
                  earlier moments, then in{" "}
                  <strong>{formatPercent(result.recent_rate)}</strong> of the
                  recent ones. The atlas records that difference. It does not
                  call it an ending.
                </>
              ) : (
                <>
                  The sound reader found this sound in{" "}
                  <strong>{formatPercent(result.baseline_rate)}</strong> of the
                  earlier moments and{" "}
                  <strong>{formatPercent(result.recent_rate)}</strong> of the
                  recent ones. This page shows the recordings behind that
                  comparison.
                </>
              )}
            </p>
            <div className="obituary-hero__actions">
              <button
                type="button"
                className="button button--ghost button--small"
                onClick={() => void copyEvidence()}
              >
                {copied ? (
                  <Check size={14} aria-hidden="true" />
                ) : (
                  <Copy size={14} aria-hidden="true" />
                )}
                {copied ? "Copied" : "Copy summary"}
              </button>
              <button
                type="button"
                className="button button--ghost button--small"
                onClick={() => window.print()}
              >
                <Printer size={14} aria-hidden="true" />
                Print
              </button>
            </div>
          </div>

          <div
            className={`obituary-seal${fading ? " obituary-seal--fading" : ""}`}
            aria-label={`Change ${result.difference_pp.toFixed(1)} points`}
          >
            <span className="obituary-seal__ring" aria-hidden="true" />
            <span className="obituary-seal__ring obituary-seal__ring--inner" aria-hidden="true" />
            <span className="obituary-seal__eyebrow">Change</span>
            <strong>{result.difference_pp > 0 ? "+" : ""}{result.difference_pp.toFixed(1)}</strong>
            <span className="obituary-seal__unit">points</span>
            <span className="obituary-seal__classification">
              {fading ? "Heard less" : "Not heard less"}
            </span>
          </div>
        </header>

        <section className="obituary-measure" aria-labelledby="measure-title">
          <header className="section-heading">
            <div>
              <p className="eyebrow">The numbers</p>
              <h2 id="measure-title">Earlier and recent</h2>
            </div>
            <ClassificationBadge
              classification={result.classification}
              fading={result.fading}
            />
          </header>
          <div className="obituary-measure__grid">
            <div className="obituary-rate-card">
              <RateComparison
                baselineRate={result.baseline_rate}
                recentRate={result.recent_rate}
                baselineLabel={`Earlier · ${formatGroupDateRange(data.baseline)}`}
                recentLabel={`Recent · ${formatGroupDateRange(data.recent)}`}
                large
              />
              <div className="obituary-rate-card__delta">
                <DeltaDisplay difference={result.difference_pp} />
                <span>
                  {data.baseline.recording_count} earlier against{" "}
                  {data.recent.recording_count} recent{" "}
                  {pluralize(data.recent.recording_count, "recording")}
                </span>
              </div>
            </div>
            <dl className="obituary-facts">
              <div>
                <dt>Times found</dt>
                <dd className="tabular">
                  {result.baseline_detected_windows.toLocaleString("en-GB")} of{" "}
                  {data.baseline.window_count.toLocaleString("en-GB")} earlier moments
                </dd>
                <dd className="tabular">
                  {result.recent_detected_windows.toLocaleString("en-GB")} of{" "}
                  {data.recent.window_count.toLocaleString("en-GB")} recent moments
                </dd>
              </div>
              <div>
                <dt>Match level</dt>
                <dd className="tabular">{data.threshold.toFixed(2)}</dd>
              </div>
              <div>
                <dt>Fading size</dt>
                <dd className="tabular">
                  {data.fading_threshold_pp.toFixed(0)} points
                </dd>
              </div>
              <div>
                <dt>Saved</dt>
                <dd>{formatDateTime(data.created_at)}</dd>
              </div>
            </dl>
          </div>
        </section>

        <div className="obituary-body">
          <section className="obituary-evidence" aria-labelledby="evidence-title">
            <header>
              <p className="eyebrow">The recordings</p>
              <h2 id="evidence-title">How each recording counted</h2>
              <p>
                Each recording counted equally. Rates show how often the sound was found in that recording.
              </p>
            </header>
            <div className="obituary-evidence__columns">
              <div>
                <h3>
                  Earlier{" "}
                  <span>{data.baseline.recording_count} {pluralize(data.baseline.recording_count, "recording")}</span>
                </h3>
                <ul className="obituary-recording-list">
                  {result.baseline_recording_rates.map((item) => (
                    <li key={item.recording_id}>
                      <Link
                        to={`/places/${data.place_id}/recordings/${item.recording_id}`}
                      >
                        {item.title}
                      </Link>
                      <span className="obituary-recording-list__rate tabular">
                        {formatPercent(item.detection_rate)}
                      </span>
                      <span className="obituary-recording-list__meta">
                        {formatDate(item.recorded_at)} ·{" "}
                        {formatDuration(item.duration_seconds)} ·{" "}
                        {item.detected_windows}/{item.window_count} moments · strongest{" "}
                        {formatScore(item.peak_score)}
                      </span>
                      {item.peak_window_start !== null && (
                        <span className="obituary-recording-list__peak">
                          Strongest moment at {formatDuration(item.peak_window_start)}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <h3>
                  Recent{" "}
                  <span>{data.recent.recording_count} {pluralize(data.recent.recording_count, "recording")}</span>
                </h3>
                <ul className="obituary-recording-list">
                  {result.recent_recording_rates.map((item) => (
                    <li key={item.recording_id}>
                      <Link
                        to={`/places/${data.place_id}/recordings/${item.recording_id}`}
                      >
                        {item.title}
                      </Link>
                      <span className="obituary-recording-list__rate tabular">
                        {formatPercent(item.detection_rate)}
                      </span>
                      <span className="obituary-recording-list__meta">
                        {formatDate(item.recorded_at)} ·{" "}
                        {formatDuration(item.duration_seconds)} ·{" "}
                        {item.detected_windows}/{item.window_count} moments · strongest{" "}
                        {formatScore(item.peak_score)}
                      </span>
                      {item.peak_window_start !== null && (
                        <span className="obituary-recording-list__peak">
                          Strongest moment at {formatDuration(item.peak_window_start)}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </section>

          <aside className="obituary-caveat">
            <TriangleAlert size={18} aria-hidden="true" />
            <h2>What this does not mean</h2>
            <p>
              It does not prove that this sound has vanished, and it does not explain why. The result only describes the recordings you chose.
            </p>
            <p>
              “{result.label}” is a broad sound type, not a species or a known source. Microphone, placement, weather, and time of day can all change what was captured.
            </p>
            <p>
              The comparison is a fixed snapshot. You can read it again, but later recordings will not change it.
            </p>
          </aside>
        </div>

        <ReflectionPanel
          comparisonId={data.id}
          classIndex={result.class_index}
          label={result.label}
          context={buildReflectionContext(data, result)}
        />

        <section className="obituary-source">
          <div>
            <p className="eyebrow">Details</p>
            <h2>
              Sound reader · {data.model_name}
            </h2>
            <p>
              Saved {formatDateTime(data.created_at)}. {data.baseline.window_count.toLocaleString("en-GB")} earlier and{" "}
              {data.recent.window_count.toLocaleString("en-GB")} recent moments.
            </p>
          </div>
          <div className="obituary-source__actions">
            <Link
              className="button button--ghost button--small"
              to={`/comparisons/${data.id}`}
            >
              <ArrowLeft size={14} aria-hidden="true" />
              Back to comparison
            </Link>
            <Link
              className="button button--ghost button--small"
              to={`/places/${data.place_id}/map`}
            >
              <BookOpen size={14} aria-hidden="true" />
              Sound map
            </Link>
          </div>
        </section>
      </article>

      {(previous || next) && (
        <nav className="obituary-pagination" aria-label="Sounds heard less">
          {previous ? (
            <Link
              to={`/comparisons/${data.id}/obituary/${previous.class_index}`}
              className="obituary-pagination__link"
            >
              <ArrowLeft size={16} aria-hidden="true" />
              <span>
                <small>Previous</small>
                <strong>{previous.label}</strong>
              </span>
            </Link>
          ) : (
            <span />
          )}
          {next ? (
            <Link
              to={`/comparisons/${data.id}/obituary/${next.class_index}`}
              className="obituary-pagination__link obituary-pagination__link--next"
            >
              <span>
                <small>Next</small>
                <strong>{next.label}</strong>
              </span>
              <ArrowRight size={16} aria-hidden="true" />
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </div>
  );
}
