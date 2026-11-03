import {
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type FormEvent,
} from "react";
import { FileAudio, Loader2, Mic, RotateCcw, Upload, X } from "lucide-react";
import { api } from "../api";
import {
  audioFileProblem,
  formatDateTime,
  formatDuration,
  formatFileSize,
  fromLocalDateTimeInput,
  getErrorMessage,
  nowForDateTimeInput,
  titleFromFilename,
} from "../utils";
import { useToast } from "./Toast";
import { Recorder } from "./Recorder";
import {
  RemoteProcessingNotice,
  isServerProcessing,
} from "./RemoteProcessingNotice";

type Mode = "upload" | "microphone";

export function RecordingIntake({
  placeId,
  onCreated,
}: {
  placeId: number;
  onCreated: (recordingId: number) => void;
}) {
  const [mode, setMode] = useState<Mode>("upload");
  const [title, setTitle] = useState("");
  const [titleTouched, setTitleTouched] = useState(false);
  const [notes, setNotes] = useState("");
  const [recordedAt, setRecordedAt] = useState(nowForDateTimeInput());
  const [file, setFile] = useState<File | null>(null);
  const [fileDuration, setFileDuration] = useState<number | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [analyzeNow, setAnalyzeNow] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [remoteAccepted, setRemoteAccepted] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const { push } = useToast();

  useEffect(() => {
    if (!file) {
      setPreviewUrl(null);
      setFileDuration(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    const audio = new Audio();
    audio.preload = "metadata";
    let active = true;
    audio.onloadedmetadata = () => {
      if (active && Number.isFinite(audio.duration) && audio.duration > 0) {
        setFileDuration(audio.duration);
        if (audio.duration > 180) {
          setFileError(
            `This file is ${formatDuration(audio.duration)} long. The limit is 3 minutes.`,
          );
        } else if (audio.duration < 1) {
          setFileError("Recordings must be at least one second long.");
        }
      }
    };
    audio.src = url;
    return () => {
      active = false;
      audio.onloadedmetadata = null;
      audio.src = "";
      URL.revokeObjectURL(url);
    };
  }, [file]);

  const setSelectedFile = (nextFile: File | null) => {
    setError(null);
    setFileError(null);
    setFileDuration(null);
    if (!nextFile) {
      setFile(null);
      if (fileInput.current) {
        fileInput.current.value = "";
      }
      return;
    }
    const problem = audioFileProblem(nextFile);
    if (problem) {
      setFileError(problem);
      setFile(null);
      return;
    }
    setFile(nextFile);
    if (mode === "upload" && !titleTouched && !title.trim()) {
      setTitle(titleFromFilename(nextFile.name));
    }
  };

  const chooseFile = (candidate: File | undefined) => {
    if (candidate) {
      setSelectedFile(candidate);
    }
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragActive(false);
    const candidate = event.dataTransfer.files?.[0];
    if (candidate) {
      setSelectedFile(candidate);
    }
  };

  const switchMode = (nextMode: Mode) => {
    if (submitting || nextMode === mode) {
      return;
    }
    setMode(nextMode);
    setSelectedFile(null);
    setFileError(null);
    setError(null);
  };

  const handleRecorded = (recorded: File | null, duration: number) => {
    setSelectedFile(recorded);
    setFileDuration(recorded ? duration : null);
    if (recorded && !titleTouched && !title.trim()) {
      setTitle(`Recording · ${formatDateTime(new Date().toISOString())}`);
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (!file) {
      setFileError(
        mode === "microphone"
          ? "Record something first."
          : "Choose a file first.",
      );
      return;
    }
    const problem = audioFileProblem(file);
    if (problem) {
      setFileError(problem);
      return;
    }
    if (fileDuration !== null && (fileDuration < 1 || fileDuration > 180)) {
      setFileError(
        "The recording must be between one second and three minutes long.",
      );
      return;
    }
    if (isServerProcessing() && !remoteAccepted) {
      setError("Confirm the server processing notice before saving.");
      return;
    }
    setSubmitting(true);
    try {
      const recording = await api.uploadRecording(placeId, {
        file,
        title: title.trim(),
        notes: notes.trim(),
        recordedAt: fromLocalDateTimeInput(recordedAt),
        source: mode === "microphone" ? "browser_recording" : "upload",
      });

      let analysisMessage = "";
      if (analyzeNow) {
        try {
          await api.analyzeRecording(recording.id);
          analysisMessage =
            "Recording saved. Finding sounds…";
        } catch (analysisError) {
          push(
            `Recording saved, but the sound search could not start: ${getErrorMessage(analysisError)}`,
            "error",
          );
        }
      }
      push(analysisMessage || "Recording saved.", "success");
      setSubmitting(false);
      onCreated(recording.id);
    } catch (uploadError) {
      setError(getErrorMessage(uploadError));
      setSubmitting(false);
    }
  };

  return (
    <section className="intake" aria-labelledby="intake-heading">
      <header className="intake__header">
        <div>
          <p className="eyebrow">Add a sound</p>
          <h2 id="intake-heading">Add a recording</h2>
          <p>
            One file, one moment. Add a title and any notes you want to keep with it.
          </p>
        </div>
        <span className="intake__privacy">
          {isServerProcessing() ? "Processed on the server" : "Stays on this device"}
        </span>
      </header>

      <div className="intake__modes" role="tablist" aria-label="Recording source">
        <button
          type="button"
          role="tab"
          aria-selected={mode === "upload"}
          className={`intake-mode${mode === "upload" ? " is-active" : ""}`}
          onClick={() => switchMode("upload")}
          disabled={submitting}
        >
          <Upload size={16} aria-hidden="true" />
          <span>
            <strong>Upload a file</strong>
            <small>WAV, FLAC, MP3, or Ogg · up to 3 min</small>
          </span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "microphone"}
          className={`intake-mode${mode === "microphone" ? " is-active" : ""}`}
          onClick={() => switchMode("microphone")}
          disabled={submitting}
        >
          <Mic size={16} aria-hidden="true" />
          <span>
            <strong>Record now</strong>
            <small>Record with this device</small>
          </span>
        </button>
      </div>

      <form className="intake__form" onSubmit={(event) => void submit(event)}>
        <div className="intake__capture">
          {mode === "upload" ? (
            <>
              <div
                className={`file-drop${dragActive ? " is-dragging" : ""}${
                  file ? " has-file" : ""
                }`}
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragActive(true);
                }}
                onDragLeave={() => setDragActive(false)}
                onDrop={handleDrop}
              >
                <input
                  ref={fileInput}
                  id="audio-file"
                  type="file"
                  accept=".wav,.flac,.mp3,.ogg,audio/*"
                  className="visually-hidden"
                  onChange={(event) => chooseFile(event.currentTarget.files?.[0])}
                />
                {file ? (
                  <div className="file-card">
                    <div className="file-card__icon">
                      <FileAudio size={22} aria-hidden="true" />
                    </div>
                    <div className="file-card__body">
                      <p className="file-card__name">{file.name}</p>
                      <p className="file-card__meta">
                        {formatFileSize(file.size)}
                        {fileDuration !== null && ` · ${formatDuration(fileDuration)}`}
                      </p>
                      {previewUrl && (
                        <audio className="file-card__audio" controls src={previewUrl}>
                          Your browser cannot preview this audio file.
                        </audio>
                      )}
                    </div>
                    <div className="file-card__actions">
                      <button
                        type="button"
                        className="button button--ghost button--small"
                        onClick={() => fileInput.current?.click()}
                        disabled={submitting}
                      >
                        <RotateCcw size={13} aria-hidden="true" />
                        Replace
                      </button>
                      <button
                        type="button"
                        className="icon-button"
                        aria-label="Remove selected file"
                        onClick={() => setSelectedFile(null)}
                        disabled={submitting}
                      >
                        <X size={16} />
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="file-drop__invitation">
                    <Upload size={22} aria-hidden="true" />
                    <div>
                      <p>
                        Drop a sound file here, or{" "}
                        <label htmlFor="audio-file" className="text-link">
                          browse this device
                        </label>
                        .
                      </p>
                      <span>WAV, FLAC, MP3, or Ogg Vorbis · up to 80 MB</span>
                    </div>
                  </div>
                )}
              </div>
              {fileError && (
                <p className="form-error" role="alert">
                  {fileError}
                </p>
              )}
            </>
          ) : (
            <>
              <Recorder onRecorded={handleRecorded} />
              {fileError && (
                <p className="form-error" role="alert">
                  {fileError}
                </p>
              )}
            </>
          )}
        </div>

        <div className="intake__fields">
          <div className="field field--wide">
            <label htmlFor="intake-title-input">
              Title <span className="field__optional">optional</span>
            </label>
            <input
              id="intake-title-input"
              value={title}
              maxLength={200}
              onChange={(event) => {
                setTitle(event.currentTarget.value);
                setTitleTouched(true);
              }}
              placeholder={
                mode === "microphone"
                  ? "Microphone recording"
                  : "The yard after rain"
              }
            />
          </div>
          <div className="field">
            <label htmlFor="intake-date">When</label>
            <input
              id="intake-date"
              type="datetime-local"
              value={recordedAt}
              onChange={(event) => setRecordedAt(event.currentTarget.value)}
              required
            />
          </div>
          <div className="field field--wide">
            <label htmlFor="intake-notes">
              Notes <span className="field__optional">optional</span>
            </label>
            <textarea
              id="intake-notes"
              rows={4}
              value={notes}
              maxLength={8000}
              onChange={(event) => setNotes(event.currentTarget.value)}
              placeholder="Weather, time of day, or what you hoped to hear…"
            />
            <span className="field__count">{notes.length} / 8,000</span>
          </div>

          <label className="check-field field--wide">
            <input
              type="checkbox"
              checked={analyzeNow}
              onChange={(event) => setAnalyzeNow(event.currentTarget.checked)}
            />
            <span>
              <strong>Find sounds now</strong>
              <small>
                Starts the sound search as soon as the recording is saved. You can also do it later.
              </small>
            </span>
          </label>

          <RemoteProcessingNotice
            accepted={remoteAccepted}
            onChange={setRemoteAccepted}
          />

          {error && (
            <p className="form-error field--wide" role="alert">
              {error}
            </p>
          )}

          <div className="intake__submit field--wide">
            <p>
              {isServerProcessing()
                ? "The file is sent to the Hush Atlas server for analysis and storage."
                : "The file and its results stay in your atlas on this device."}
            </p>
            <button
              type="submit"
              className="button button--primary"
              disabled={
                submitting || !file || (isServerProcessing() && !remoteAccepted)
              }
            >
              {submitting ? (
                <Loader2 className="spin" size={15} aria-hidden="true" />
              ) : (
                <Upload size={15} aria-hidden="true" />
              )}
              {submitting ? "Saving…" : "Save recording"}
            </button>
          </div>
        </div>
      </form>
    </section>
  );
}
