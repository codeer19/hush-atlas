import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowRight,
  ArrowUpRight,
  Edit3,
  Map,
  Mic,
  Plus,
  Scale,
  Trash2,
  Waves,
} from "lucide-react";
import { api, isRemoteApi } from "../api";
import type { Recording } from "../types";
import {
  formatDate,
  formatDateTime,
  formatDuration,
  formatPercent,
  formatTotalDuration,
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
import { Breadcrumbs, PageHeader } from "../components/PageHeader";
import { EmptyState, ErrorPanel, LoadingPanel } from "../components/States";
import { StatusBadge, Badge } from "../components/StatusBadge";
import { PlaceDialog } from "../components/PlaceDialog";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { RecordingIntake } from "../components/RecordingIntake";
import { useToast } from "../components/Toast";

function RecordingRow({
  recording,
  index,
}: {
  recording: Recording;
  index: number;
}) {
  return (
    <li>
      <Link
        className="recording-row"
        to={`/places/${recording.place_id}/recordings/${recording.id}`}
      >
        <span className="recording-row__index tabular">
          {String(index + 1).padStart(2, "0")}
        </span>
        <span className="recording-row__main">
          <span className="recording-row__title">{recording.title}</span>
          <span className="recording-row__meta">
            {formatDateTime(recording.recorded_at)} ·{" "}
            {formatDuration(recording.duration_seconds)} ·{" "}
            {sourceLabel(recording.source)}
          </span>
        </span>
        <span className="recording-row__classes">
          {recording.top_classes.length > 0 ? (
            recording.top_classes.map((item) => (
              <span className="class-tag" key={item.class_index}>
                <span>{item.label}</span>
                <span className="class-tag__rate">
                  {formatPercent(item.detection_rate, 0)}
                </span>
              </span>
            ))
          ) : (
            <span className="recording-row__none">
              {recording.analysis_status === "completed"
                ? "No sounds found"
                : "No results yet"}
            </span>
          )}
        </span>
        <StatusBadge status={recording.analysis_status} compact />
        <ArrowRight
          size={16}
          className="recording-row__arrow"
          aria-hidden="true"
        />
      </Link>
    </li>
  );
}

export function PlacePage() {
  const params = useParams();
  const placeId = Number(params.placeId);
  const navigate = useNavigate();
  const { push } = useToast();
  const validId = Number.isInteger(placeId) && placeId > 0;
  const place = useResource(`place:${placeId}`, () => api.place(placeId));
  const comparisons = useResource(`comparisons:${placeId}`, () =>
    api.comparisons(placeId),
  );
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [intakeOpen, setIntakeOpen] = useState(false);
  const initialized = useRef(false);

  const data = place.data;

  useDocumentTitle(data?.name);

  useEffect(() => {
    if (data && !initialized.current) {
      initialized.current = true;
      setIntakeOpen(data.recordings.length === 0);
    }
  }, [data]);

  const anyAnalysisActive = Boolean(
    data?.recordings.some((recording) =>
      isAnalysisActive(recording.analysis_status),
    ),
  );
  usePolling(() => place.refresh(), anyAnalysisActive ? 3500 : null);

  if (!validId) {
    return (
      <div className="shell page">
        <ErrorPanel
          title="This place could not be opened"
          message="The address is not valid."
        />
        <Link className="text-link" to="/">
          Back to my atlas
        </Link>
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

  if (place.error || !data) {
    return (
      <div className="shell page">
        <Breadcrumbs items={[{ label: "My atlas", to: "/archive" }, { label: "Place" }]} />
        <ErrorPanel
          title="This place could not be opened"
          message={place.error ?? "This place does not exist."}
          onRetry={place.refresh}
        />
        <Link className="text-link" to="/">
          Back to my atlas
        </Link>
      </div>
    );
  }

  const analyzed = data.recordings.filter(
    (recording) => recording.analysis_status === "completed",
  ).length;
  const totalDuration = data.recordings.reduce(
    (total, recording) => total + recording.duration_seconds,
    0,
  );
  const canCompare = analyzed >= 2;
  const canMap = analyzed >= 1;
  const earliest = data.recordings.length
    ? data.recordings[data.recordings.length - 1].recorded_at
    : null;
  const latest = data.recordings[0]?.recorded_at ?? null;

  const saveEdit = async (values: { name: string; description: string }) => {
    await api.updatePlace(data.id, values);
    push("Place saved.", "success");
    setEditOpen(false);
    place.refresh();
  };

  const deletePlace = async () => {
    setDeleting(true);
    try {
      const result = await api.deletePlace(data.id);
      if (result.warnings.length > 0) {
        push(result.warnings.join(" "), "error");
      } else {
        push(`“${data.name}” was removed.`, "success");
      }
      navigate("/");
    } catch (error) {
      push(getErrorMessage(error), "error");
      setDeleting(false);
    }
  };

  return (
    <div className="shell page">
      <Breadcrumbs
        items={[{ label: "My atlas", to: "/archive" }, { label: data.name }]}
      />

      {data.is_demo && (
        <div className="demo-note">
          <Badge tone="amber">Sample place</Badge>
          <p>
            This place uses sample audio. The sound results are real model
            output, not prewritten labels.
          </p>
          <Link to="/demo" className="text-link">
            About the sample <ArrowUpRight size={13} aria-hidden="true" />
          </Link>
        </div>
      )}

      <PageHeader
        eyebrow={`Place · added ${formatDate(data.created_at)}`}
        title={data.name}
        lede={
          data.description ? (
            <p className="preserve-lines">{data.description}</p>
          ) : (
            <p className="muted">No notes for this place yet.</p>
          )
        }
        actions={
          <>
            <button
              type="button"
              className="button button--primary button--small"
              onClick={() => setIntakeOpen(true)}
            >
              <Plus size={15} aria-hidden="true" />
              Add a recording
            </button>
            <button
              type="button"
              className="button button--ghost button--small"
              onClick={() => setEditOpen(true)}
            >
              <Edit3 size={14} aria-hidden="true" />
              Edit
            </button>
          </>
        }
        aside={
          <div className="record-actions">
            {canCompare ? (
              <Link
                className="record-action"
                to={`/places/${data.id}/compare`}
              >
                <Scale size={17} aria-hidden="true" />
                <span>
                  <strong>Compare</strong>
                  <small>Compare two visits</small>
                </span>
                <ArrowRight size={14} aria-hidden="true" />
              </Link>
            ) : (
              <span className="record-action is-disabled" aria-disabled="true">
                <Scale size={17} aria-hidden="true" />
                <span>
                  <strong>Compare</strong>
                  <small>Needs two recordings with results</small>
                </span>
              </span>
            )}
            {canMap ? (
              <Link className="record-action" to={`/places/${data.id}/map`}>
                <Map size={17} aria-hidden="true" />
                <span>
                  <strong>Sound map</strong>
                  <small>See sounds across time</small>
                </span>
                <ArrowRight size={14} aria-hidden="true" />
              </Link>
            ) : (
              <span className="record-action is-disabled" aria-disabled="true">
                <Map size={17} aria-hidden="true" />
                <span>
                  <strong>Sound map</strong>
                  <small>Needs one recording with results</small>
                </span>
              </span>
            )}
          </div>
        }
      />

      <section className="place-stats" aria-label="Place summary">
        <div>
          <span>Recordings</span>
          <strong className="tabular">{data.recording_count}</strong>
        </div>
        <div>
          <span>With results</span>
          <strong className="tabular">
            {analyzed} / {data.recording_count}
          </strong>
        </div>
        <div>
          <span>Listening time</span>
          <strong className="tabular">{formatTotalDuration(totalDuration)}</strong>
        </div>
        <div>
          <span>Dates</span>
          <strong className="place-stats__dates">
            {earliest ? formatDate(earliest) : "—"}
            {latest && latest !== earliest ? ` – ${formatDate(latest)}` : ""}
          </strong>
        </div>
        <span className="place-stats__mark" aria-hidden="true">
          <Waves size={18} />
        </span>
      </section>

      {intakeOpen && (
        <div className="section section--tight">
          <RecordingIntake
            placeId={data.id}
            onCreated={(recordingId) => {
              navigate(`/places/${data.id}/recordings/${recordingId}`);
            }}
          />
        </div>
      )}

      <section className="section" aria-labelledby="recordings-title">
        <header className="section-heading">
          <div>
            <p className="eyebrow">Sounds</p>
            <h2 id="recordings-title">Recordings</h2>
          </div>
          <div className="section-heading__actions">
            <span className="section-heading__count tabular">
              {data.recordings.length}{" "}
              {pluralize(data.recordings.length, "recording")}
            </span>
            {!intakeOpen && (
              <button
                type="button"
                className="button button--ghost button--small"
                onClick={() => setIntakeOpen(true)}
              >
                <Plus size={14} aria-hidden="true" />
                Add
              </button>
            )}
          </div>
        </header>

        {data.recordings.length === 0 ? (
          <EmptyState
            icon={<Mic size={24} />}
            eyebrow="Nothing recorded yet"
            title="Add the first sound."
            body={
              <p>
                Upload a file or record from this device.{" "}
                {isRemoteApi()
                  ? "The original is uploaded for analysis and stored with its results."
                  : "The original stays here, with its results."}
              </p>
            }
            action={
              !intakeOpen ? (
                <button
                  type="button"
                  className="button button--primary"
                  onClick={() => setIntakeOpen(true)}
                >
                  <Plus size={16} aria-hidden="true" />
                  Add a recording
                </button>
              ) : undefined
            }
          />
        ) : (
          <ul className="recording-list">
            {data.recordings.map((recording, index) => (
              <RecordingRow
                key={recording.id}
                recording={recording}
                index={data.recordings.length - index - 1}
              />
            ))}
          </ul>
        )}

        {!canCompare && data.recordings.length > 0 && (
          <p className="section-note">
            Comparisons unlock when two recordings have results. {analyzed === 0 ? "None yet." : `${analyzed} so far.`}
          </p>
        )}
      </section>

      <section className="section" aria-labelledby="history-title">
        <header className="section-heading">
          <div>
            <p className="eyebrow">Past comparisons</p>
            <h2 id="history-title">Times you compared.</h2>
          </div>
          {canCompare && (
            <Link
              className="button button--ghost button--small"
              to={`/places/${data.id}/compare`}
            >
              <Scale size={14} aria-hidden="true" />
              Compare recordings
            </Link>
          )}
        </header>

        {comparisons.loading ? (
          <LoadingPanel label="Opening comparisons" compact />
        ) : comparisons.error ? (
          <ErrorPanel
            message={comparisons.error}
            title="Comparisons could not be opened"
            onRetry={comparisons.refresh}
          />
        ) : comparisons.data && comparisons.data.length > 0 ? (
          <ul className="comparison-history">
            {comparisons.data.map((item) => (
              <li key={item.id}>
                <Link
                  className="comparison-history__item"
                  to={`/comparisons/${item.id}`}
                >
                  <span className="comparison-history__date">
                    {formatDate(item.created_at)}
                  </span>
                  <span className="comparison-history__groups">
                    {item.baseline_count} earlier · {item.recent_count} recent
                  </span>
                  <span className="comparison-history__counts">
                    <strong className="tabular">{item.fading_count}</strong> less often
                    {item.notable_count > 0 && (
                      <>
                        {" "}
                        · <strong className="tabular">{item.notable_count}</strong>{" "}
                        changed
                      </>
                    )}
                  </span>
                  <ArrowRight size={15} aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="section-note">
            No comparisons yet. Once two recordings have results, you can compare them.
          </p>
        )}
      </section>

      <section className="section section--danger">
        <div>
          <p className="eyebrow">Remove this place</p>
          <h2>Delete this place</h2>
          <p>
            This removes the place, its {data.recording_count}{" "}
            {pluralize(data.recording_count, "recording")}, results, and
            comparisons.{" "}
            {isRemoteApi()
              ? "Audio files are deleted from the Hush Atlas server."
              : "Audio files are deleted from this device."}{" "}
            This cannot be undone.
          </p>
        </div>
        <button
          type="button"
          className="button button--danger button--small"
          onClick={() => setDeleteOpen(true)}
        >
          <Trash2 size={14} aria-hidden="true" />
          Delete place
        </button>
      </section>

      <PlaceDialog
        open={editOpen}
        place={data}
        onClose={() => setEditOpen(false)}
        onSave={saveEdit}
      />

      <ConfirmDialog
        open={deleteOpen}
        title={`Delete “${data.name}”?`}
        description={
          <>
            <p>
              This place and all {data.recording_count}{" "}
              {pluralize(data.recording_count, "recording")} will be permanently
              removed from{" "}
              {isRemoteApi() ? "the Hush Atlas server" : "this device"}, with
              their results and comparisons.
            </p>
            <p>This cannot be undone.</p>
          </>
        }
        confirmLabel="Delete place"
        busy={deleting}
        onCancel={() => setDeleteOpen(false)}
        onConfirm={() => void deletePlace()}
      />
    </div>
  );
}
