import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  AlertTriangle,
  ArrowLeft,
  Download,
  Edit3,
  Gauge,
  Loader2,
  Radio,
  RefreshCw,
  SlidersHorizontal,
  Trash2,
  Waves,
} from "lucide-react";
import { api, isRemoteApi } from "../api";
import {
  formatDateTime,
  formatDuration,
  formatScore,
  getErrorMessage,
  isAnalysisActive,
  pluralize,
  sourceLabel,
} from "../utils";
import {
  useDocumentTitle,
  usePolling,
  useResource,
} from "../hooks";
import { AudioPlayer, type AudioPlayerHandle } from "../components/AudioPlayer";
import { AnalysisClasses } from "../components/AnalysisClasses";
import { Breadcrumbs, PageHeader } from "../components/PageHeader";
import {
  EmptyState,
  ErrorPanel,
  LoadingPanel,
  Spinner,
} from "../components/States";
import { StatusBadge } from "../components/StatusBadge";
import { RecordingEditDialog } from "../components/RecordingEditDialog";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { useToast } from "../components/Toast";

export function RecordingPage() {
  const params = useParams();
  const placeId = Number(params.placeId);
  const recordingId = Number(params.recordingId);
  const navigate = useNavigate();
  const { push } = useToast();
  const player = useRef<AudioPlayerHandle>(null);
  const valid =
    Number.isInteger(placeId) &&
    placeId > 0 &&
    Number.isInteger(recordingId) &&
    recordingId > 0;

  const detail = useResource(`recording:${recordingId}`, () =>
    api.recording(recordingId),
  );
  const analysis = useResource(`analysis:${recordingId}`, () =>
    api.analysis(recordingId),
  );

  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [threshold, setThreshold] = useState(0.2);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const thresholdInitialized = useRef(false);

  const data = detail.data;
  useDocumentTitle(data?.title);

  useEffect(() => {
    if (
      analysis.data?.analysis &&
      !thresholdInitialized.current
    ) {
      thresholdInitialized.current = true;
      setThreshold(analysis.data.analysis.threshold);
    }
  }, [analysis.data]);

  const active =
    (data ? isAnalysisActive(data.analysis_status) : false) ||
    (analysis.data
      ? isAnalysisActive(analysis.data.status)
      : false);
  const needsAnalysisFetch =
    data?.analysis_status === "completed" &&
    !analysis.data &&
    !analysis.error;
  usePolling(
    () => {
      detail.refresh();
      analysis.refresh();
    },
    active || needsAnalysisFetch ? 2600 : null,
  );

  if (!valid) {
    return (
      <div className="shell page">
        <ErrorPanel
          title="This recording could not be opened"
          message="The address is not valid."
        />
        <Link className="text-link" to="/">
          Back to my atlas
        </Link>
      </div>
    );
  }

  if (detail.loading) {
    return (
      <div className="shell page">
        <LoadingPanel label="Opening the recording" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="shell page">
        <Breadcrumbs
          items={[
            { label: "My atlas", to: "/archive" },
            { label: "Place", to: `/places/${placeId}` },
            { label: "Recording" },
          ]}
        />
        <ErrorPanel
          title="This recording could not be opened"
          message={detail.error ?? "This recording does not exist."}
          onRetry={detail.refresh}
        />
        <Link className="text-link" to={`/places/${placeId}`}>
          Back to the place
        </Link>
      </div>
    );
  }

  const run = analysis.data?.analysis ?? null;
  const analysisError =
    analysis.data?.error ?? data.analysis_error ?? analysis.error;
  const status = data.analysis_status;
  const activeStatus = isAnalysisActive(status);

  const saveDetails = async (patch: {
    title: string;
    notes: string;
    recorded_at: string;
  }) => {
    await api.updateRecording(data.id, patch);
    push("Changes saved.", "success");
    setEditOpen(false);
    detail.refresh();
  };

  const deleteRecording = async () => {
    setDeleting(true);
    try {
      const result = await api.deleteRecording(data.id);
      if (result.warnings.length > 0) {
        push(result.warnings.join(" "), "error");
      } else {
        push("Recording removed.", "success");
      }
      navigate(`/places/${data.place_id}`);
    } catch (error) {
      push(getErrorMessage(error), "error");
      setDeleting(false);
    }
  };

  const analyze = async () => {
    setAnalyzing(true);
    try {
      const result = await api.analyzeRecording(data.id, {
        threshold,
        force: status === "completed",
      });
      push(result.message, "success");
      detail.refresh();
      analysis.refresh();
    } catch (error) {
      push(getErrorMessage(error), "error");
    } finally {
      setAnalyzing(false);
    }
  };

  return (
    <div className="shell page">
      <Breadcrumbs
        items={[
          { label: "My atlas", to: "/archive" },
          { label: data.place_name, to: `/places/${data.place_id}` },
          { label: data.title },
        ]}
      />

      <PageHeader
        eyebrow={`Sound · ${data.place_name}`}
        title={data.title}
        lede={
          <p className="recording-submeta">
            {formatDateTime(data.recorded_at)}
            <span aria-hidden="true">·</span>
            {formatDuration(data.duration_seconds)}
            <span aria-hidden="true">·</span>
            {data.audio_format}
            <span aria-hidden="true">·</span>
            {sourceLabel(data.source)}
          </p>
        }
        actions={
          <>
            <StatusBadge status={status} />
            <button
              type="button"
              className="button button--ghost button--small"
              onClick={() => setEditOpen(true)}
            >
              <Edit3 size={14} aria-hidden="true" />
              Edit
            </button>
            <a
              className="button button--ghost button--small"
              href={data.audio_url}
              download={data.original_filename}
            >
              <Download size={14} aria-hidden="true" />
              Download
            </a>
            <button
              type="button"
              className="button button--danger button--small"
              onClick={() => setDeleteOpen(true)}
            >
              <Trash2 size={14} aria-hidden="true" />
              Delete
            </button>
          </>
        }
      />

      {detail.error && data && (
        <p className="inline-warning">
          Could not refresh: {detail.error} Showing the last version.
        </p>
      )}

      <div className="recording-grid">
        <section className="audio-card" aria-labelledby="audio-title">
          <header className="audio-card__head">
            <div>
              <p className="eyebrow">Original audio</p>
              <h2 id="audio-title">Listen</h2>
            </div>
            <span className="audio-card__file">{data.original_filename}</span>
          </header>
          <AudioPlayer
            ref={player}
            src={data.audio_url}
            title={data.title}
            durationSeconds={data.duration_seconds}
            peaks={data.waveform.peaks}
          />
          <dl className="audio-meta">
            <div>
              <dt>Audio quality</dt>
              <dd>{(data.sample_rate / 1000).toFixed(1)} kHz</dd>
            </div>
            <div>
              <dt>Channels</dt>
              <dd>{data.channels === 1 ? "Mono" : data.channels === 2 ? "Stereo" : data.channels}</dd>
            </div>
            <div>
              <dt>File type</dt>
              <dd>{data.audio_format}</dd>
            </div>
            <div>
              <dt>Added from</dt>
              <dd>{sourceLabel(data.source)}</dd>
            </div>
          </dl>
        </section>

        <aside className="field-notes-card">
          <header>
            <p className="eyebrow">Notes</p>
            <button
              type="button"
              className="text-button"
              onClick={() => setEditOpen(true)}
            >
              Edit
            </button>
          </header>
          {data.notes ? (
            <p className="preserve-lines">{data.notes}</p>
          ) : (
            <p className="muted">
              No notes yet. Add what you remember about the weather, the hour, or what was happening.
            </p>
          )}
          <footer className="field-notes-card__footer">
            <Radio size={14} aria-hidden="true" />
            <span>
              Added {formatDateTime(data.created_at)}
              {data.updated_at !== data.created_at &&
                ` · edited ${formatDateTime(data.updated_at)}`}
            </span>
          </footer>
        </aside>
      </div>

      <section className="section analysis-section" aria-labelledby="analysis-title">
        <header className="section-heading">
          <div>
            <p className="eyebrow">Sounds found</p>
            <h2 id="analysis-title">Results</h2>
          </div>
          <div className="analysis-controls">
            <button
              type="button"
              className="button button--ghost button--small"
              onClick={() => setSettingsOpen((open) => !open)}
              aria-expanded={settingsOpen}
            >
              <SlidersHorizontal size={14} aria-hidden="true" />
              Settings
            </button>
            {status === "completed" ? (
              <button
                type="button"
                className="button button--ghost button--small"
                onClick={() => void analyze()}
                disabled={analyzing || activeStatus}
              >
                {analyzing ? (
                  <Loader2 className="spin" size={14} aria-hidden="true" />
                ) : (
                  <RefreshCw size={14} aria-hidden="true" />
                )}
                Try again
              </button>
            ) : (
              <button
                type="button"
                className="button button--primary button--small"
                onClick={() => void analyze()}
                disabled={analyzing || activeStatus}
              >
                {analyzing ? (
                  <Loader2 className="spin" size={14} aria-hidden="true" />
                ) : (
                  <Waves size={14} aria-hidden="true" />
                )}
                {status === "failed" ? "Try again" : "Find sounds"}
              </button>
            )}
          </div>
        </header>

        {settingsOpen && (
          <div className="analysis-settings">
            <div>
              <label htmlFor="analysis-threshold">
                Match level{" "}
                <strong className="tabular">{threshold.toFixed(2)}</strong>
              </label>
              <input
                id="analysis-threshold"
                type="range"
                min={0.05}
                max={0.8}
                step={0.05}
                value={threshold}
                onChange={(event) =>
                  setThreshold(Number(event.currentTarget.value))
                }
              />
            </div>
            <p>
              Lower values include more sounds. Higher values keep only the clearest matches.
            </p>
          </div>
        )}

        {activeStatus && (
          <div className="analysis-status" role="status">
            <Spinner size={20} />
            <div>
              <h3>
                {status === "queued"
                  ? "Waiting to start"
                  : "Looking for sounds"}
              </h3>
              <p>
                {isRemoteApi()
                  ? "This runs on the Hush Atlas server. You can leave this page open; it will update when the result is ready."
                  : "This runs on your device. You can leave this page open; it will update when the result is ready."}
              </p>
            </div>
          </div>
        )}

        {status === "failed" && !activeStatus && (
          <div className="analysis-status analysis-status--error" role="alert">
            <AlertTriangle size={20} aria-hidden="true" />
            <div>
              <h3>The result did not finish</h3>
              <p>{analysisError ?? "Something went wrong. Try again."}</p>
            </div>
          </div>
        )}

        {status === "not_analyzed" && (
          <EmptyState
            icon={<Gauge size={24} />}
            eyebrow="No results yet"
            title="Find the sounds in this recording."
            body={
              <p>
                {isRemoteApi()
                  ? "This runs on the Hush Atlas server. Your recording is uploaded when you start."
                  : "This runs on your device. Nothing is uploaded."}
              </p>
            }
            action={
              <button
                type="button"
                className="button button--primary"
                onClick={() => void analyze()}
                disabled={analyzing}
              >
                {analyzing ? (
                  <Loader2 className="spin" size={15} aria-hidden="true" />
                ) : (
                  <Waves size={15} aria-hidden="true" />
                )}
                Find sounds
              </button>
            }
          />
        )}

        {analysis.error && !analysis.data && (
          <ErrorPanel
            title="The results could not be opened"
            message={analysis.error}
            onRetry={analysis.refresh}
          />
        )}

        {analysis.loading && !analysis.data && status !== "not_analyzed" && (
          <LoadingPanel label="Opening the results" compact />
        )}

        {run && run.status === "completed" && (
          <div className="analysis-layout">
            <div className="analysis-main">
              <AnalysisClasses
                classes={run.classes}
                duration={run.duration_seconds}
                threshold={run.threshold}
                onSeek={(seconds) => player.current?.seek(seconds, true)}
              />
            </div>
            <aside className="evidence-card">
              <header>
                <p className="eyebrow">Details</p>
                <h3>How this was made</h3>
              </header>
              <dl className="evidence-list">
                <div>
                  <dt>Sound reader</dt>
                  <dd>{run.model_name}</dd>
                </div>
                {run.model_version && (
                  <div>
                    <dt>Version</dt>
                    <dd>{run.model_version}</dd>
                  </div>
                )}
                <div>
                  <dt>Match level</dt>
                  <dd className="tabular">{run.threshold.toFixed(2)}</dd>
                </div>
                <div>
                  <dt>Moments</dt>
                  <dd className="tabular">{run.window_count}</dd>
                </div>
                <div>
                  <dt>Gap between moments</dt>
                  <dd className="tabular">{run.window_hop_seconds.toFixed(2)} s</dd>
                </div>
                <div>
                  <dt>Finished</dt>
                  <dd>{formatDateTime(run.completed_at)}</dd>
                </div>
              </dl>
              <p className="evidence-card__note">
                The sound reader names broad sound types, not species. A stronger match means the sound reader is more sure, not that the sound is definitely there.
              </p>
              <p className="evidence-card__note">
                {run.classes.length}{" "}
                {pluralize(run.classes.length, "sound type", "sound types")} passed the
                match level.{" "}
                {run.classes.reduce(
                  (total, item) => total + item.events.length,
                  0,
                )}{" "}
                times were saved. The strongest match is{" "}
                <strong>
                  {formatScore(
                    run.classes.reduce(
                      (maximum, item) => Math.max(maximum, item.peak_score),
                      0,
                    ),
                  )}
                </strong>
                .
              </p>
            </aside>
          </div>
        )}

        {run && run.status !== "completed" && !activeStatus && (
          <p className="section-note">
            The last sound search did not finish. {run.error_message ?? "Try again when you are ready."}
          </p>
        )}
      </section>

      <div className="back-row">
        <Link className="text-link" to={`/places/${data.place_id}`}>
          <ArrowLeft size={14} aria-hidden="true" />
          Back to {data.place_name}
        </Link>
      </div>

      <RecordingEditDialog
        open={editOpen}
        recording={data}
        onClose={() => setEditOpen(false)}
        onSave={saveDetails}
      />

      <ConfirmDialog
        open={deleteOpen}
        title="Delete this recording?"
        description={
          <>
            <p>
              “{data.title}” and its audio, results, and comparisons will be removed from{" "}
              {isRemoteApi() ? "the Hush Atlas server" : "this device"}.
            </p>
            <p>This cannot be undone.</p>
          </>
        }
        confirmLabel="Delete recording"
        busy={deleting}
        onCancel={() => setDeleteOpen(false)}
        onConfirm={() => void deleteRecording()}
      />
    </div>
  );
}
