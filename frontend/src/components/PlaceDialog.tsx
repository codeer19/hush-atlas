import { useEffect, useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import type { Place } from "../types";
import { getErrorMessage } from "../utils";
import { Modal } from "./Modal";

interface PlaceDialogProps {
  open: boolean;
  place?: Place | null;
  onClose: () => void;
  onSave: (values: { name: string; description: string }) => Promise<void>;
}

export function PlaceDialog({ open, place, onClose, onSave }: PlaceDialogProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    setName(place?.name ?? "");
    setDescription(place?.description ?? "");
    setError(null);
    setBusy(false);
  }, [open, place]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) {
      setError("Add a name.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSave({
        name: name.trim(),
        description: description.trim(),
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
      eyebrow={place ? "Edit place" : "Add a place"}
      title={place ? "Edit place" : "Add a place"}
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
            form="place-form"
            className="button button--primary"
            disabled={busy}
          >
            {busy && <Loader2 className="spin" size={15} aria-hidden="true" />}
            {busy ? "Saving…" : place ? "Save changes" : "Add place"}
          </button>
        </>
      }
    >
      <form id="place-form" className="form" onSubmit={(event) => void submit(event)}>
        <div className="field">
          <label htmlFor="place-name">Name</label>
          <input
            id="place-name"
            data-autofocus
            value={name}
            maxLength={120}
            onChange={(event) => setName(event.currentTarget.value)}
            placeholder="The yard after rain"
            autoComplete="off"
            required
          />
          <span className="field__hint">
            A street, a room, a shoreline, or a commute.
          </span>
        </div>
        <div className="field">
          <label htmlFor="place-description">
            Description <span className="field__optional">optional</span>
          </label>
          <textarea
            id="place-description"
            value={description}
            maxLength={4000}
            rows={5}
            onChange={(event) => setDescription(event.currentTarget.value)}
            placeholder="What should someone know before listening here?"
          />
          <span className="field__count">{description.length} / 4,000</span>
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
