import { useEffect, useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import type { Recording } from "../types";
import {
  fromLocalDateTimeInput,
  getErrorMessage,
  toLocalDateTimeInput,
} from "../utils";
import { Modal } from "./Modal";

interface RecordingEditDialogProps {
  open: boolean;
  recording: Recording;
  onClose: () => void;
  onSave: (patch: {
    title: string;
    notes: string;
    recorded_at: string;
  }) => Promise<void>;
}

export function RecordingEditDialog({
  open,
  recording,
  onClose,
  onSave,
}: RecordingEditDialogProps) {
  const [title, setTitle] = useState(recording.title);
  const [notes, setNotes] = useState(recording.notes);
  const [recordedAt, setRecordedAt] = useState(
    toLocalDateTimeInput(recording.recorded_at),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    setTitle(recording.title);
    setNotes(recording.notes);
    setRecordedAt(toLocalDateTimeInput(recording.recorded_at));
    setError(null);
    setBusy(false);
  }, [open, recording]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim()) {
      setError("Add a title.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSave({
        title: title.trim(),
        notes: notes.trim(),
        recorded_at: fromLocalDateTimeInput(recordedAt),
      });
      setBusy(false);
    } catch (saveError) {
      setError(getErrorMessage(saveError));
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={busy ? () => undefined : onClose}
      eyebrow="Edit recording"
      title="Recording details"
      footer={
        <>
          <button
            type="button"
            className="button button--ghost"
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            type="submit"
            form="recording-edit-form"
            className="button button--primary"
            disabled={busy}
          >
            {busy && <Loader2 className="spin" size={15} aria-hidden="true" />}
            {busy ? "Saving…" : "Save changes"}
          </button>
        </>
      }
    >
      <form
        id="recording-edit-form"
        className="form"
        onSubmit={(event) => void submit(event)}
      >
        <div className="field">
          <label htmlFor="edit-title">Title</label>
          <input
            id="edit-title"
            data-autofocus
            value={title}
            maxLength={200}
            required
            onChange={(event) => setTitle(event.currentTarget.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="edit-date">When</label>
          <input
            id="edit-date"
            type="datetime-local"
            value={recordedAt}
            onChange={(event) => setRecordedAt(event.currentTarget.value)}
          />
          <span className="field__hint">
            This date is used to order your recordings, not the upload time.
          </span>
        </div>
        <div className="field">
          <label htmlFor="edit-notes">
            Notes <span className="field__optional">optional</span>
          </label>
          <textarea
            id="edit-notes"
            value={notes}
            maxLength={8000}
            rows={5}
            onChange={(event) => setNotes(event.currentTarget.value)}
            placeholder="What was happening around you?"
          />
          <span className="field__count">{notes.length} / 8,000</span>
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}
