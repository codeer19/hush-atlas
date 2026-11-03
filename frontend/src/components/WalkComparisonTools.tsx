import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowRight,
  GitCompareArrows,
  Loader2,
  TriangleAlert,
} from "lucide-react";
import { api } from "../api";
import type { ComparabilityPreview, Walk } from "../types";
import { formatDateTime, getErrorMessage, pluralize } from "../utils";
import { useResource } from "../hooks";
import { useToast } from "../components/Toast";

export function WalkComparisonTools({ walk }: { walk: Walk }) {
  const navigate = useNavigate();
  const { push } = useToast();
  const [busy, setBusy] = useState<"previous" | "stops" | null>(null);
  const [baselineStopId, setBaselineStopId] = useState("");
  const [recentStopId, setRecentStopId] = useState("");
  const previous = walk.previous_visit;
  const preview = useResource<ComparabilityPreview | null>(
    `walk-preview-${walk.id}-${previous?.id ?? "none"}`,
    () => (previous ? api.walkComparisonPreview(walk.id, previous.id) : Promise.resolve(null)),
  );

  const analyzedStops = useMemo(
    () =>
      walk.stops.filter(
        (stop) => stop.recording?.analysis_status === "completed",
      ),
    [walk.stops],
  );

  useEffect(() => {
    if (analyzedStops.length >= 2) {
      setBaselineStopId((current) =>
        current || String(analyzedStops[0].id),
      );
      setRecentStopId((current) =>
        current || String(analyzedStops[1].id),
      );
    }
  }, [analyzedStops]);

  const comparePrevious = async () => {
    if (!previous) {
      return;
    }
    setBusy("previous");
    try {
      const comparison = await api.compareWalk(walk.id, {
        other_session_id: previous.id,
      });
      navigate(`/comparisons/${comparison.id}`);
    } catch (error) {
      push(getErrorMessage(error), "error");
      setBusy(null);
    }
  };

  const compareStops = async () => {
    if (!baselineStopId || !recentStopId) {
      push("Choose two stops with results first.", "error");
      return;
    }
    if (baselineStopId === recentStopId) {
      push("Choose two different stops.", "error");
      return;
    }
    setBusy("stops");
    try {
      const comparison = await api.compareWalk(walk.id, {
        baseline_stop_ids: [Number(baselineStopId)],
        recent_stop_ids: [Number(recentStopId)],
      });
      navigate(`/comparisons/${comparison.id}`);
    } catch (error) {
      push(getErrorMessage(error), "error");
      setBusy(null);
    }
  };

  return (
    <section className="walk-compare" aria-labelledby="compare-heading">
      <div className="walk-compare__head">
        <GitCompareArrows size={18} aria-hidden="true" />
        <div>
          <p className="eyebrow">Compare</p>
          <h2 id="compare-heading">Compare visits.</h2>
        </div>
      </div>

      {previous && (
        <div className="walk-compare__block">
          <div className="walk-compare__block-head">
            <div>
              <h3>Previous visit</h3>
              <p>
                {previous.title} ·{" "}
                {formatDateTime(previous.completed_at ?? previous.started_at)}
              </p>
            </div>
            <button
              type="button"
              className="button button--primary button--small"
              onClick={() => void comparePrevious()}
              disabled={busy !== null || !analyzedStops.length}
            >
              {busy === "previous" ? (
                <Loader2 className="spin" size={14} aria-hidden="true" />
              ) : (
                <ArrowRight size={14} aria-hidden="true" />
              )}
              Compare visits
            </button>
          </div>
          {preview.loading && <p className="field__hint">Checking stops…</p>}
          {preview.error && (
            <p className="field__hint">{preview.error}</p>
          )}
          {preview.data && (
            <div className="walk-compare__preview">
              <p>
                <strong className="tabular">
                  {preview.data.comparable_pairs}
                </strong>{" "}
                of {preview.data.pairs.length}{" "}
                {pluralize(preview.data.pairs.length, "stop")} can be compared.
              </p>
              {preview.data.warnings.length > 0 && (
                <ul>
                  {preview.data.warnings.map((warning) => (
                    <li key={warning}>
                      <TriangleAlert size={13} aria-hidden="true" /> {warning}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}

      <div className="walk-compare__block">
        <h3>Two stops in this walk</h3>
        <p>
          Choose two stops with results. The comparison uses your saved sound results.
        </p>
        {analyzedStops.length < 2 ? (
          <p className="field__hint">
            You need two stops with results. {analyzedStops.length} of{" "}
            {walk.stops.length} ready so far.
          </p>
        ) : (
          <div className="walk-compare__selects">
            <div className="field">
              <label htmlFor="baseline-stop">Earlier stop</label>
              <select
                id="baseline-stop"
                value={baselineStopId}
                onChange={(event) => setBaselineStopId(event.currentTarget.value)}
              >
                {analyzedStops.map((stop) => (
                  <option value={stop.id} key={stop.id}>
                    {stop.stop_order + 1}. {stop.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="recent-stop">Later stop</label>
              <select
                id="recent-stop"
                value={recentStopId}
                onChange={(event) => setRecentStopId(event.currentTarget.value)}
              >
                {analyzedStops.map((stop) => (
                  <option value={stop.id} key={stop.id}>
                    {stop.stop_order + 1}. {stop.name}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              className="button button--ghost button--small"
              onClick={() => void compareStops()}
              disabled={busy !== null}
            >
              {busy === "stops" ? (
                <Loader2 className="spin" size={14} aria-hidden="true" />
              ) : (
                <GitCompareArrows size={14} aria-hidden="true" />
              )}
              Compare stops
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
