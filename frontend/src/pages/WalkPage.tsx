import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Clock3,
  Download,
  Ear,
  Loader2,
  Map as MapIcon,
  Mic,
  Pause,
  Play,
  RefreshCw,
  Route as RouteIcon,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { api } from "../api";
import type { Walk, WalkStop, WalkStopStatus } from "../types";
import {
  formatDateTime,
  formatDuration,
  getErrorMessage,
  pluralize,
} from "../utils";
import { useDocumentTitle, usePolling, useResource } from "../hooks";
import { Breadcrumbs } from "../components/PageHeader";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { ErrorPanel, LoadingPanel, Spinner } from "../components/States";
import { StatusBadge } from "../components/StatusBadge";
import { StopRecording } from "../components/StopRecording";
import { WalkComparisonTools } from "../components/WalkComparisonTools";
import { useToast } from "../components/Toast";

const ANALYZING = new Set(["analysis_pending"]);

export function WalkPage() {
  const params = useParams();
  const sessionId = Number(params.sessionId);
  const valid = Number.isInteger(sessionId) && sessionId > 0;
  const navigate = useNavigate();
  const { push } = useToast();
  const walk = useResource<Walk>(
    valid ? `walk-${sessionId}` : "walk-invalid",
    () => api.walk(sessionId),
  );
  const [observations, setObservations] = useState<Record<number, string>>({});
  const [savingStop, setSavingStop] = useState<number | null>(null);
  const [walkBusy, setWalkBusy] = useState<"pause" | "resume" | "repeat" | null>(
    null,
  );
  const [confirm, setConfirm] = useState<"complete" | "delete" | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);

  const data = walk.data;
  const analysisActive =
    data?.stops.some(
      (stop) =>
        ANALYZING.has(stop.status) ||
        stop.recording?.analysis_status === "queued" ||
        stop.recording?.analysis_status === "running",
    ) ?? false;

  useDocumentTitle(data ? data.title : "Walk");
  usePolling(() => walk.refresh(), analysisActive ? 2500 : null);

  useEffect(() => {
    if (!data) {
      return;
    }
    setObservations((current) => {
      const next = { ...current };
      let changed = false;
      for (const stop of data.stops) {
        if (!(stop.id in next)) {
          next[stop.id] = stop.observation;
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [data]);

  if (!valid) {
    return (
      <div className="shell page">
        <ErrorPanel
          title="This walk could not be opened"
          message="The walk address is not valid."
        />
      </div>
    );
  }

  if (walk.loading && !data) {
    return (
      <div className="shell page">
        <LoadingPanel label="Opening your walk" />
      </div>
    );
  }

  if (walk.error && !data) {
    return (
      <div className="shell page">
        <Breadcrumbs
          items={[{ label: "Missions", to: "/" }, { label: "Walk" }]}
        />
        <ErrorPanel
          title="This walk could not be opened"
          message={walk.error}
          onRetry={walk.refresh}
        />
      </div>
    );
  }

  if (!data) {
    return null;
  }

  const active = data.status === "active";
  const isComplete = data.status === "completed";
  const stopCount = data.progress.total_stops;

  const updateStopState = async (
    stop: WalkStop,
    status: WalkStopStatus,
    message: string,
  ) => {
    setSavingStop(stop.id);
    try {
      await api.updateWalkStop(data.id, stop.id, { status });
      walk.refresh();
      push(message, "success");
    } catch (error) {
      push(getErrorMessage(error), "error");
    } finally {
      setSavingStop(null);
    }
  };

  const saveObservation = async (stop: WalkStop) => {
    setSavingStop(stop.id);
    try {
      await api.updateWalkStop(data.id, stop.id, {
        observation: observations[stop.id] ?? "",
      });
      walk.refresh();
      push("Note saved.", "success");
    } catch (error) {
      push(getErrorMessage(error), "error");
    } finally {
      setSavingStop(null);
    }
  };

  const changeWalkStatus = async (status: "active" | "paused") => {
    setWalkBusy(status === "paused" ? "pause" : "resume");
    try {
      await api.updateWalk(data.id, { status });
      walk.refresh();
      push(
        status === "paused"
          ? "Walk paused. Everything is safe."
          : "Walk resumed.",
        "success",
      );
    } catch (error) {
      push(getErrorMessage(error), "error");
    } finally {
      setWalkBusy(null);
    }
  };

  const repeat = async () => {
    setWalkBusy("repeat");
    try {
      const next = await api.repeatWalk(data.id);
      push("New visit ready. Same route.", "success");
      navigate(`/walks/${next.id}`);
    } catch (error) {
      push(getErrorMessage(error), "error");
      setWalkBusy(null);
    }
  };

  const completeWalk = async () => {
    setConfirmBusy(true);
    try {
      await api.updateWalk(data.id, { status: "completed" });
      setConfirm(null);
      walk.refresh();
      push("Walk finished. You can reopen it later.", "success");
    } catch (error) {
      push(getErrorMessage(error), "error");
    } finally {
      setConfirmBusy(false);
    }
  };

  const removeWalk = async () => {
    setConfirmBusy(true);
    try {
      await api.deleteWalk(data.id);
      push("Walk removed. Recordings stay in your atlas.", "success");
      navigate("/archive");
    } catch (error) {
      push(getErrorMessage(error), "error");
      setConfirmBusy(false);
    }
  };

  const percent =
    stopCount > 0
      ? Math.round((data.progress.recorded_stops / stopCount) * 100)
      : 0;

  return (
    <div className="shell page walk-page">
      <Breadcrumbs
        items={[
          { label: "Missions", to: "/" },
          { label: "My atlas", to: "/archive" },
          { label: data.title },
        ]}
      />

      <header className="walk-header">
        <div className="walk-header__main">
          <p className="eyebrow">
            {data.mission_title} · {data.place_name}
          </p>
          <h1>{data.title}</h1>
          <p className="walk-header__lede">
            {data.mission_short_description || "A walk through this place."}
          </p>
          <div className="walk-header__meta">
            <StatusBadge status={data.status} kind="walk" />
            {data.route_name && (
              <span>
                <RouteIcon size={13} aria-hidden="true" /> {data.route_name}
              </span>
            )}
            <span>
              <Clock3 size={13} aria-hidden="true" /> Started{" "}
              {formatDateTime(data.started_at)}
            </span>
            {data.completed_at && (
              <span>Completed {formatDateTime(data.completed_at)}</span>
            )}
            {data.is_demo && <span className="badge badge--amber">Sample</span>}
          </div>
        </div>
        <div className="walk-header__actions">
          <Link className="button button--ghost button--small" to={`/walks/${data.id}/map`}>
            <MapIcon size={14} aria-hidden="true" />
            Sound map
          </Link>
          <a
            className="button button--ghost button--small"
            href={api.walkReportUrl(data.id)}
          >
            <Download size={14} aria-hidden="true" />
            Report
          </a>
          {data.route_id && (
            <button
              type="button"
              className="button button--ghost button--small"
              onClick={() => void repeat()}
              disabled={walkBusy !== null}
            >
              {walkBusy === "repeat" ? (
                <Spinner size={14} />
              ) : (
                <RefreshCw size={14} aria-hidden="true" />
              )}
              Repeat route
            </button>
          )}
          {active && (
            <button
              type="button"
              className="button button--ghost button--small"
              onClick={() => void changeWalkStatus("paused")}
              disabled={walkBusy !== null}
            >
              {walkBusy === "pause" ? (
                <Spinner size={14} />
              ) : (
                <Pause size={14} aria-hidden="true" />
              )}
              Pause
            </button>
          )}
          {data.status === "paused" && (
            <button
              type="button"
              className="button button--primary button--small"
              onClick={() => void changeWalkStatus("active")}
              disabled={walkBusy !== null}
            >
              {walkBusy === "resume" ? (
                <Spinner size={14} />
              ) : (
                <Play size={14} aria-hidden="true" />
              )}
              Resume
            </button>
          )}
          {isComplete && (
            <button
              type="button"
              className="button button--ghost button--small"
              onClick={() => void changeWalkStatus("active")}
              disabled={walkBusy !== null}
            >
              <Play size={14} aria-hidden="true" /> Reopen
            </button>
          )}
          {!isComplete && (
            <button
              type="button"
              className="button button--primary button--small"
              onClick={() => setConfirm("complete")}
              disabled={data.progress.recorded_stops === 0}
            >
              <Check size={14} aria-hidden="true" /> Complete walk
            </button>
          )}
        </div>
      </header>

      <section className="walk-progress" aria-label="Walk progress">
        <div className="walk-progress__bar" aria-hidden="true">
          <span style={{ width: `${percent}%` }} />
        </div>
        <div className="walk-progress__counts">
          <div>
            <span>Stops</span>
            <strong className="tabular">{stopCount}</strong>
          </div>
          <div>
            <span>Recorded</span>
            <strong className="tabular">{data.progress.recorded_stops}</strong>
          </div>
          <div>
            <span>Results ready</span>
            <strong className="tabular">{data.progress.analyzed_stops}</strong>
          </div>
          <div>
            <span>Checked</span>
            <strong className="tabular">{data.progress.reviewed_stops}</strong>
          </div>
          {data.progress.failed_analysis_stops > 0 && (
            <div className="walk-progress__failed">
              <span>Results failed</span>
              <strong className="tabular">
                {data.progress.failed_analysis_stops}
              </strong>
            </div>
          )}
        </div>
      </section>

      {data.status === "paused" && (
        <div className="walk-paused-note" role="status">
          <Pause size={15} aria-hidden="true" />
          This walk is paused. Your notes and recordings are safe. Resume when you are ready.
        </div>
      )}

      <div className="walk-layout">
        <div className="walk-stops">
          <div className="walk-stops__head">
            <div>
              <p className="eyebrow">Your walk</p>
              <h2>Stops.</h2>
            </div>
            <span className="tabular">
              {data.progress.recorded_stops} / {stopCount} recorded
            </span>
          </div>

          <ol className="stop-list">
            {data.stops.map((stop) => {
              const observation = observations[stop.id] ?? stop.observation;
              const dirty = observation !== stop.observation;
              const recording = stop.recording;
              const reviewed =
                stop.status === "reviewed" || stop.status === "completed";
              return (
                <li
                  className={`walk-stop walk-stop--${stop.status}`}
                  id={`stop-${stop.id}`}
                  key={stop.id}
                >
                  <div className="walk-stop__marker" aria-hidden="true">
                    <span className="tabular">
                      {String(stop.stop_order + 1).padStart(2, "0")}
                    </span>
                  </div>
                  <div className="walk-stop__body">
                    <header className="walk-stop__head">
                      <div>
                        <h3>{stop.name}</h3>
                        <div className="walk-stop__meta">
                          <StatusBadge status={stop.status} kind="stop" compact />
                          {stop.latitude !== null &&
                            stop.longitude !== null && (
                              <span className="tabular">
                                {stop.latitude.toFixed(5)},{" "}
                                {stop.longitude.toFixed(5)}
                              </span>
                            )}
                          {stop.interrupted_recording && (
                            <span className="walk-stop__interrupted">
                              <TriangleAlert size={12} aria-hidden="true" />
                              Recording stopped early. Nothing was saved.
                            </span>
                          )}
                        </div>
                      </div>
                      {reviewed && (
                        <span className="walk-stop__reviewed">
                          <Check size={13} aria-hidden="true" /> Checked
                        </span>
                      )}
                    </header>

                    {stop.status === "ready_to_listen" && active && (
                      <div className="listen-step">
                        <div className="listen-step__icon" aria-hidden="true">
                          <Ear size={20} />
                        </div>
                        <div>
                          <h4>Listen before recording.</h4>
                          <p>
                            Stop for a moment. Listen for twenty seconds. Notice what is near, far, and unexpected. Then mark that you have listened.
                          </p>
                          <button
                            type="button"
                            className="button button--primary button--small"
                            onClick={() =>
                              void updateStopState(
                                stop,
                                "listening",
                                "Listening marked. The recorder is still locked.",
                              )
                            }
                            disabled={savingStop === stop.id}
                          >
                            {savingStop === stop.id ? (
                              <Spinner size={14} />
                            ) : (
                              <Ear size={14} aria-hidden="true" />
                            )}
                            Start listening
                          </button>
                        </div>
                      </div>
                    )}

                    {stop.status === "listening" && active && (
                      <div className="listen-step listen-step--active">
                        <div className="listen-step__icon" aria-hidden="true">
                          <Mic size={20} />
                        </div>
                        <div>
                          <h4>Stay a little longer.</h4>
                          <p>
                            When you are ready, unlock the recorder. Your own note stays separate from the sound reader.
                          </p>
                          <button
                            type="button"
                            className="button button--primary button--small"
                            onClick={() =>
                              void updateStopState(
                                stop,
                                "ready_to_record",
                                "Recorder unlocked.",
                              )
                            }
                            disabled={savingStop === stop.id}
                          >
                            {savingStop === stop.id ? (
                              <Spinner size={14} />
                            ) : (
                              <Mic size={14} aria-hidden="true" />
                            )}
                            I have listened — ready to record
                          </button>
                        </div>
                      </div>
                    )}

                    {!["ready_to_listen", "listening"].includes(stop.status) && (
                      <div className="walk-stop__observation">
                        <label htmlFor={`observation-${stop.id}`}>
                          Your observation{" "}
                          <span className="field__optional">
                            in your own words
                          </span>
                        </label>
                        <textarea
                          id={`observation-${stop.id}`}
                          value={observation}
                          onChange={(event) =>
                            setObservations((current) => ({
                              ...current,
                              [stop.id]: event.currentTarget.value,
                            }))
                          }
                          rows={3}
                          maxLength={2000}
                          placeholder="What did you hear? Near, far, steady, or unexpected?"
                        />
                        <div className="walk-stop__observation-actions">
                          <span className="field__hint">
                            {dirty
                              ? "Unsaved note"
                              : stop.observation
                                ? "Saved with this stop"
                                : "No note yet"}
                          </span>
                          <button
                            type="button"
                            className="button button--ghost button--small"
                            onClick={() => void saveObservation(stop)}
                            disabled={!dirty || savingStop === stop.id}
                          >
                            {savingStop === stop.id ? (
                              <Spinner size={13} />
                            ) : (
                              <Check size={13} aria-hidden="true" />
                            )}
                            Save note
                          </button>
                        </div>
                      </div>
                    )}

                    {!["ready_to_listen", "listening"].includes(stop.status) && (
                      <StopRecording
                        sessionId={data.id}
                        stop={stop}
                        active={active}
                        onChanged={walk.refresh}
                      />
                    )}

                    {recording?.analysis_status === "completed" && !reviewed && (
                      <div className="walk-stop__review">
                        <p>
                          Compare what the sound reader found with what you noticed. This does not change the recording.
                        </p>
                        <button
                          type="button"
                          className="button button--ghost button--small"
                          onClick={() =>
                            void updateStopState(
                              stop,
                              "reviewed",
                              "Stop checked.",
                            )
                          }
                          disabled={savingStop === stop.id}
                        >
                          <Check size={13} aria-hidden="true" />
                          Mark as checked
                        </button>
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        </div>

        <aside className="walk-aside">
          <section className="walk-aside__panel">
            <p className="eyebrow">Notes</p>
            <h2>About this walk.</h2>
            {data.notes ? (
              <p>{data.notes}</p>
            ) : (
              <p className="walk-aside__muted">
                No notes for this walk yet. You can still write a note at each stop.
              </p>
            )}
            <dl className="walk-aside__facts">
              <div>
                <dt>Mission</dt>
                <dd>{data.mission_title}</dd>
              </div>
              <div>
                <dt>Place</dt>
                <dd>
                  <Link to={`/places/${data.place_id}`}>{data.place_name}</Link>
                </dd>
              </div>
              {data.route_name && (
                <div>
                  <dt>Route</dt>
                  <dd>
                    {data.route_id ? (
                      <Link to={`/routes/${data.route_id}`}>
                        {data.route_name}
                      </Link>
                    ) : (
                      data.route_name
                    )}
                  </dd>
                </div>
              )}
              <div>
                <dt>Clip length</dt>
                <dd>{formatDuration(data.recording_duration_seconds)}</dd>
              </div>
              <div>
                <dt>Stops left</dt>
                <dd>{data.progress.remaining_stops}</dd>
              </div>
            </dl>
          </section>

          {data.previous_visit && (
            <section className="walk-aside__panel walk-aside__panel--previous">
              <p className="eyebrow">Earlier visit</p>
              <h3>{data.previous_visit.title}</h3>
              <p className="walk-aside__muted">
                Completed{" "}
                {formatDateTime(
                  data.previous_visit.completed_at ??
                    data.previous_visit.started_at,
                )}{" "}
                · {data.previous_visit.stops.length}{" "}
                {pluralize(data.previous_visit.stops.length, "stop")}
              </p>
              <Link
                className="text-link"
                to={`/walks/${data.previous_visit.id}`}
              >
                Open earlier visit <ArrowRight size={14} aria-hidden="true" />
              </Link>
            </section>
          )}

          <section className="walk-aside__panel">
            <p className="eyebrow">Good to know</p>
            <h3>How the results work.</h3>
            <ul className="walk-aside__limits">
              <li>Your notes and the sound reader&apos;s labels are kept separately.</li>
              <li>The sound reader names broad sound types, not species.</li>
              <li>The percentages are a rough share, not a measure of loudness.</li>
              <li>If a result fails, the original audio is kept so you can try again.</li>
            </ul>
            <Link className="text-link" to={`/walks/${data.id}/map`}>
              Open the sound map <ArrowRight size={14} aria-hidden="true" />
            </Link>
          </section>

          <section className="walk-aside__panel walk-aside__panel--danger">
            <p className="eyebrow">Remove</p>
            <p>
              Recordings stay in your atlas. The route and notes for this walk will be removed.
            </p>
            <button
              type="button"
              className="button button--danger button--small"
              onClick={() => setConfirm("delete")}
            >
              <Trash2 size={14} aria-hidden="true" /> Delete walk
            </button>
          </section>
        </aside>
      </div>

      {data.progress.recorded_stops > 0 && (
        <WalkComparisonTools walk={data} />
      )}

      <div className="walk-footer-nav">
        <Link className="back-link" to="/archive">
          <ArrowLeft size={15} aria-hidden="true" /> Back to my atlas
        </Link>
        <Link className="text-link" to={`/walks/${data.id}/map`}>
          Open the sound map{" "}
          <ArrowRight size={14} aria-hidden="true" />
        </Link>
      </div>

      <ConfirmDialog
        open={confirm === "complete"}
        title="Complete this walk?"
        eyebrow="Close the session"
        description={
          <p>
            This walk will be marked finished. You can reopen it later. Recordings and notes stay where they are.
          </p>
        }
        confirmLabel="Complete walk"
        busy={confirmBusy}
        onCancel={() => setConfirm(null)}
        onConfirm={() => void completeWalk()}
      />

      <ConfirmDialog
        open={confirm === "delete"}
        title="Delete this walk?"
        eyebrow="Remove the session"
        description={
          <p>
            The walk and its stop notes will be removed. Recordings stay in your atlas. This cannot be undone.
          </p>
        }
        confirmLabel="Delete walk"
        busy={confirmBusy}
        onCancel={() => setConfirm(null)}
        onConfirm={() => void removeWalk()}
      />
    </div>
  );
}
