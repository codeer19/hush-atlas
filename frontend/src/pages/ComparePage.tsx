import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  CalendarRange,
  Loader2,
  Scale,
  SplitSquareVertical,
} from "lucide-react";
import { api } from "../api";
import {
  DEFAULT_DETECTION_THRESHOLD,
  DEFAULT_FADING_THRESHOLD_PP,
  compareRecordings,
  formatDate,
  formatDuration,
  getErrorMessage,
  pluralize,
  suggestComparisonGroups,
} from "../utils";
import { useDocumentTitle, useResource } from "../hooks";
import { Breadcrumbs, PageHeader } from "../components/PageHeader";
import { EmptyState, ErrorPanel, LoadingPanel } from "../components/States";
import { StatusBadge } from "../components/StatusBadge";
import { useToast } from "../components/Toast";

type Assignment = "baseline" | "recent" | "skip";

export function ComparePage() {
  const params = useParams();
  const placeId = Number(params.placeId);
  const navigate = useNavigate();
  const { push } = useToast();
  const validId = Number.isInteger(placeId) && placeId > 0;
  const place = useResource(`place:${placeId}`, () => api.place(placeId));
  const [assignments, setAssignments] = useState<Record<number, Assignment>>({});
  const [threshold, setThreshold] = useState(DEFAULT_DETECTION_THRESHOLD);
  const [fadingThreshold, setFadingThreshold] = useState(
    DEFAULT_FADING_THRESHOLD_PP,
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const initialized = useRef(false);

  const data = place.data;
  useDocumentTitle(data ? `Compare ${data.name}` : "Compare");

  const sortedRecordings = useMemo(
    () => (data ? [...data.recordings].sort(compareRecordings) : []),
    [data],
  );

  useEffect(() => {
    if (!data || initialized.current) {
      return;
    }
    initialized.current = true;
    const suggested = suggestComparisonGroups(data.recordings);
    const next: Record<number, Assignment> = {};
    for (const id of suggested.baseline) {
      next[id] = "baseline";
    }
    for (const id of suggested.recent) {
      next[id] = "recent";
    }
    setAssignments(next);
  }, [data]);

  const analyzed = sortedRecordings.filter(
    (recording) => recording.analysis_status === "completed",
  );
  const baseline = sortedRecordings.filter(
    (recording) => assignments[recording.id] === "baseline",
  );
  const recent = sortedRecordings.filter(
    (recording) => assignments[recording.id] === "recent",
  );

  const dateRange = (items: typeof sortedRecordings) => {
    if (items.length === 0) {
      return "No recordings assigned";
    }
    const first = items[0];
    const last = items[items.length - 1];
    return first.recorded_at === last.recorded_at
      ? formatDate(first.recorded_at)
      : `${formatDate(first.recorded_at)} – ${formatDate(last.recorded_at)}`;
  };

  const assign = (recordingId: number, group: Assignment) => {
    setAssignments((current) => ({ ...current, [recordingId]: group }));
  };

  const splitByDate = () => {
    if (!data) {
      return;
    }
    const suggested = suggestComparisonGroups(data.recordings);
    const next: Record<number, Assignment> = {};
    for (const id of suggested.baseline) {
      next[id] = "baseline";
    }
    for (const id of suggested.recent) {
      next[id] = "recent";
    }
    setAssignments(next);
  };

  const clear = () => setAssignments({});

  const create = async () => {
    if (!data) {
      return;
    }
    if (baseline.length === 0 || recent.length === 0) {
      setError("Choose at least one recording with results for each group.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const comparison = await api.createComparison({
        place_id: data.id,
        baseline_recording_ids: baseline.map((item) => item.id),
        recent_recording_ids: recent.map((item) => item.id),
        threshold,
        fading_threshold_pp: fadingThreshold,
      });
      push(
        `Comparison saved with ${baseline.length} earlier and ${recent.length} recent ${pluralize(
          recent.length,
          "recording",
        )}.`,
        "success",
      );
      navigate(`/comparisons/${comparison.id}`);
    } catch (createError) {
      setError(getErrorMessage(createError));
      setSubmitting(false);
    }
  };

  if (!validId) {
    return (
      <div className="shell page">
        <ErrorPanel
          title="This comparison could not be started"
          message="The address is not valid."
        />
      </div>
    );
  }

  if (place.loading) {
    return (
      <div className="shell page">
        <LoadingPanel label="Opening the place" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="shell page">
        <Breadcrumbs
          items={[{ label: "My atlas", to: "/archive" }, { label: "Compare" }]}
        />
        <ErrorPanel
          title="This place could not be opened"
          message={place.error ?? "This place does not exist."}
          onRetry={place.refresh}
        />
      </div>
    );
  }

  const canCompare = analyzed.length >= 2;
  const ready = baseline.length > 0 && recent.length > 0;

  return (
    <div className="shell page">
      <Breadcrumbs
        items={[
          { label: "My atlas", to: "/archive" },
          { label: data.name, to: `/places/${data.id}` },
          { label: "Compare" },
        ]}
      />

      <PageHeader
        eyebrow={`Compare · ${data.name}`}
        title="Earlier and recent."
        lede={
          <p>
            Choose which recordings are from earlier and which are recent. The
            comparison is computed from the stored recordings.
          </p>
        }
        actions={
          <Link
            className="button button--ghost button--small"
            to={`/places/${data.id}`}
          >
            <ArrowLeft size={14} aria-hidden="true" />
            Back to place
          </Link>
        }
      />

      <div className="method-callout">
        <Scale size={20} aria-hidden="true" />
        <div>
          <h2>Each recording counts once.</h2>
          <p>
            For each sound, we measure how often it was found in each recording, then average those rates. Every recording counts equally, so a long one does not dominate.
          </p>
        </div>
        <span className="method-callout__note">
          A difference, not proof of change
        </span>
      </div>

      {!canCompare ? (
        <EmptyState
          icon={<Scale size={24} />}
          eyebrow="Not enough results yet"
          title="Two recordings with results are needed."
          body={
            <p>
              {analyzed.length === 0
                ? "None of these recordings have results yet."
                : `Only ${analyzed.length} ${pluralize(analyzed.length, "recording has", "recordings have")} results.`}{" "}
              Open a recording and find its sounds first.
            </p>
          }
          action={
            <Link className="button button--primary" to={`/places/${data.id}`}>
              <ArrowLeft size={15} aria-hidden="true" />
              Back to recordings
            </Link>
          }
        />
      ) : (
        <>
          <section className="compare-step" aria-labelledby="assign-title">
            <header className="compare-step__head">
              <div>
                <span className="compare-step__number tabular">01</span>
                <div>
                  <p className="eyebrow">Choose the recordings</p>
                  <h2 id="assign-title">Earlier or recent?</h2>
                </div>
              </div>
              <div className="compare-step__actions">
                <button
                  type="button"
                  className="button button--ghost button--small"
                  onClick={splitByDate}
                >
                  <SplitSquareVertical size={14} aria-hidden="true" />
                  Use dates
                </button>
                <button
                  type="button"
                  className="button button--ghost button--small"
                  onClick={clear}
                >
                  Clear
                </button>
              </div>
            </header>

            <div className="group-summary">
              <div className="group-summary__item group-summary__item--baseline">
                <span className="group-summary__label">Earlier</span>
                <strong className="tabular">
                  {baseline.length}{" "}
                  {pluralize(baseline.length, "recording")}
                </strong>
                <span>{dateRange(baseline)}</span>
              </div>
              <ArrowRight
                className="group-summary__arrow"
                size={18}
                aria-hidden="true"
              />
              <div className="group-summary__item group-summary__item--recent">
                <span className="group-summary__label">Recent</span>
                <strong className="tabular">
                  {recent.length} {pluralize(recent.length, "recording")}
                </strong>
                <span>{dateRange(recent)}</span>
              </div>
            </div>

            <ol className="assignment-list">
              {sortedRecordings.map((recording) => {
                const assignment = assignments[recording.id] ?? "skip";
                const unavailable = recording.analysis_status !== "completed";
                return (
                  <li
                    key={recording.id}
                    className={`assignment-row${unavailable ? " is-unavailable" : ""}`}
                  >
                    <div className="assignment-row__date">
                      <CalendarRange size={15} aria-hidden="true" />
                      <span>{formatDate(recording.recorded_at)}</span>
                    </div>
                    <div className="assignment-row__main">
                      <Link
                        to={`/places/${data.id}/recordings/${recording.id}`}
                        className="assignment-row__title"
                      >
                        {recording.title}
                      </Link>
                      <span className="assignment-row__meta">
                        {formatDuration(recording.duration_seconds)}
                        {recording.top_classes.length > 0 &&
                          ` · ${recording.top_classes
                            .slice(0, 2)
                            .map((item) => item.label)
                            .join(", ")}`}
                      </span>
                    </div>
                    {unavailable ? (
                      <div className="assignment-row__unavailable">
                        <StatusBadge
                          status={recording.analysis_status}
                          compact
                        />
                        <Link
                          className="text-link"
                          to={`/places/${data.id}/recordings/${recording.id}`}
                        >
                          Find sounds first
                        </Link>
                      </div>
                    ) : (
                      <div
                        className="segmented"
                        role="group"
                        aria-label={`Group for ${recording.title}`}
                      >
                        <button
                          type="button"
                          className={
                            assignment === "baseline" ? "is-active" : undefined
                          }
                          aria-pressed={assignment === "baseline"}
                          onClick={() => assign(recording.id, "baseline")}
                        >
                          Earlier
                        </button>
                        <button
                          type="button"
                          className={
                            assignment === "skip" ? "is-active" : undefined
                          }
                          aria-pressed={assignment === "skip"}
                          onClick={() => assign(recording.id, "skip")}
                        >
                          Skip
                        </button>
                        <button
                          type="button"
                          className={
                            assignment === "recent" ? "is-active" : undefined
                          }
                          aria-pressed={assignment === "recent"}
                          onClick={() => assign(recording.id, "recent")}
                        >
                          Recent
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>
            <p className="section-note">
              Recordings are shown oldest first. Each one can go in only one group, and only recordings with results can be used.
            </p>
          </section>

          <section className="compare-step" aria-labelledby="thresholds-title">
            <header className="compare-step__head">
              <div>
                <span className="compare-step__number tabular">02</span>
                <div>
                  <p className="eyebrow">Choose a match level</p>
                  <h2 id="thresholds-title">What counts as a sound?</h2>
                </div>
              </div>
            </header>
            <div className="threshold-grid">
              <div className="threshold-card">
                <div className="threshold-card__head">
                  <label htmlFor="compare-threshold">Match level</label>
                  <strong className="tabular">{threshold.toFixed(2)}</strong>
                </div>
                <input
                  id="compare-threshold"
                  type="range"
                  min={0.05}
                  max={0.8}
                  step={0.05}
                  value={threshold}
                  onChange={(event) =>
                    setThreshold(Number(event.currentTarget.value))
                  }
                />
                <p>
                  Lower values include more sounds. Higher values keep only the clearest matches.
                </p>
              </div>
              <div className="threshold-card">
                <div className="threshold-card__head">
                  <label htmlFor="fading-threshold">
                    Fading size
                  </label>
                  <strong className="tabular">
                    {fadingThreshold.toFixed(0)} points
                  </strong>
                </div>
                <input
                  id="fading-threshold"
                  type="range"
                  min={5}
                  max={50}
                  step={1}
                  value={fadingThreshold}
                  onChange={(event) =>
                    setFadingThreshold(Number(event.currentTarget.value))
                  }
                />
                <p>
                  A sound is marked as fading when it falls by at least this many points, was found in at least 5% of earlier moments, and was present before.
                </p>
              </div>
            </div>
            <div className="compare-disclaimer">
              <p>
                With one recording in each group, a difference may come from the conditions as much as from change. More recordings make the result steadier.
              </p>
            </div>
          </section>

          <section className="compare-submit" aria-labelledby="create-title">
            <div>
              <p className="eyebrow">Save comparison</p>
              <h2 id="create-title">
                {ready
                  ? `${baseline.length} earlier ${pluralize(
                      baseline.length,
                      "recording",
                    )} against ${recent.length} recent`
                  : "Choose at least one recording for each group"}
              </h2>
              <p>
                The comparison is saved as a snapshot. New recordings will not change it.
              </p>
              {error && (
                <p className="form-error" role="alert">
                  {error}
                </p>
              )}
            </div>
            <button
              type="button"
              className="button button--primary"
              onClick={() => void create()}
              disabled={!ready || submitting}
            >
              {submitting ? (
                <Loader2 className="spin" size={16} aria-hidden="true" />
              ) : (
                <Scale size={16} aria-hidden="true" />
              )}
              {submitting ? "Comparing…" : "Compare recordings"}
            </button>
          </section>
        </>
      )}
    </div>
  );
}
