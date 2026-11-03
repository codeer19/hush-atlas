import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  AudioLines,
  FileAudio,
  Loader2,
  Mic,
  RefreshCw,
  Upload,
} from "lucide-react";
import { api } from "../api";
import type { WalkStop } from "../types";
import {
  audioFileProblem,
  formatDuration,
  formatPercent,
  fromLocalDateTimeInput,
  getErrorMessage,
  nowForDateTimeInput,
} from "../utils";
import { Spinner } from "./States";
import { StatusBadge } from "./StatusBadge";
import { useToast } from "./Toast";
import { Recorder } from "./Recorder";
import {
  RemoteProcessingNotice,
  isServerProcessing,
} from "./RemoteProcessingNotice";

type CaptureMode = "microphone" | "file";

export function StopRecording({
  sessionId,
  stop,
  active,
  onChanged,
}: {
  sessionId: number;
  stop: WalkStop;
  active: boolean;
  onChanged: () => void;
}) {
  const [mode, setMode] = useState<CaptureMode>("microphone");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [remoteAccepted, setRemoteAccepted] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const { push } = useToast();
  const recording = stop.recording;

  useEffect(() => {
    setFile(null);
    setError(null);
  }, [mode, stop.id]);

  const chooseFile = (candidate: File | undefined) => {
    if (!candidate) {
      return;
    }
    const problem = audioFileProblem(candidate);
    if (problem) {
      setError(problem);
      setFile(null);
      return;
    }
    setError(null);
    setFile(candidate);
  };

  const submit = async () => {
    if (!file) {
      setError("Record something or choose a file first.");
      return;
    }
    if (isServerProcessing() && !remoteAccepted) {
      setError("Confirm the server processing notice before saving.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const saved = await api.uploadWalkStopRecording(sessionId, stop.id, {
        file,
        title: `${stop.stop_order + 1}. ${stop.name}`,
        notes: "",
        recordedAt: fromLocalDateTimeInput(nowForDateTimeInput()),
        source: mode === "microphone" ? "browser_recording" : "upload",
      });
      try {
        await api.analyzeRecording(saved.id);
        push("Recording saved. Finding sounds…", "success");
      } catch (analysisError) {
        push(
          `Recording saved, but the sound search could not start: ${getErrorMessage(
            analysisError,
          )}`,
          "error",
        );
      }
      setFile(null);
      if (inputRef.current) {
        inputRef.current.value = "";
      }
      onChanged();
    } catch (uploadError) {
      setError(getErrorMessage(uploadError));
    } finally {
      setBusy(false);
    }
  };

  const retryAnalysis = async () => {
    if (!recording) {
      return;
    }
    setRetrying(true);
    setError(null);
    try {
      await api.analyzeRecording(recording.id, { force: true });
      push("Trying again. Your audio is unchanged.", "success");
      onChanged();
    } catch (retryError) {
      setError(getErrorMessage(retryError));
    } finally {
      setRetrying(false);
    }
  };

  if (recording) {
    return (
      <div className="stop-recording">
        <div className="stop-recording__head">
          <div>
            <p className="eyebrow">Saved recording</p>
            <h4>{recording.title}</h4>
          </div>
          <StatusBadge status={recording.analysis_status} />
        </div>
        <audio
          className="stop-recording__audio"
          controls
          preload="metadata"
          src={recording.audio_url}
        >
          Your browser does not support audio playback.
        </audio>
        <p className="stop-recording__meta">
          {formatDuration(recording.duration_seconds)} ·{" "}
          {recording.audio_format} · {recording.sample_rate.toLocaleString()} Hz
        </p>

        {recording.analysis_status === "failed" && (
          <div className="stop-recording__failed">
            <p>
              The result failed, but the recording is still here.{" "}
              {recording.analysis_error ?? ""}
            </p>
            <button
              type="button"
              className="button button--ghost button--small"
              onClick={() => void retryAnalysis()}
              disabled={retrying}
            >
              {retrying ? (
                <Loader2 className="spin" size={14} aria-hidden="true" />
              ) : (
                <RefreshCw size={14} aria-hidden="true" />
              )}
              Try again
            </button>
          </div>
        )}

        {(recording.analysis_status === "queued" ||
          recording.analysis_status === "running") && (
          <p className="analysis-wait" role="status">
            <Spinner size={14} />{" "}
            {isServerProcessing()
              ? "Looking for sounds on the server."
              : "Looking for sounds on this device."}{" "}
            This page will update.
          </p>
        )}

        {recording.analysis_status === "completed" && (
          <div className="model-output">
            <div className="model-output__head">
              <span>
                <AudioLines size={14} aria-hidden="true" /> Sounds found
              </span>
              <Link
                className="text-link"
                to={`/recordings/${recording.id}/fingerprint`}
              >
                Sound details
              </Link>
            </div>
            {recording.top_classes.length === 0 ? (
              <p className="model-output__empty">
                The sound reader found no sounds at the chosen match level. That does not mean the place was silent.
              </p>
            ) : (
              <ul className="model-class-list">
                {recording.top_classes.map((item) => (
                  <li key={item.class_index}>
                    <span>{item.label}</span>
                    <strong className="tabular">
                      {formatPercent(item.detection_rate)}
                    </strong>
                  </li>
                ))}
              </ul>
            )}
            <p className="model-output__note">
              These are broad sound types, not species or known sources. Your note is kept separately.
            </p>
          </div>
        )}
      </div>
    );
  }

  if (!active) {
    return (
      <p className="stop-recording__paused">
        Resume the walk to record here.
      </p>
    );
  }

  return (
    <div className="stop-capture">
      <div className="stop-capture__modes" role="tablist" aria-label="Recording source">
        <button
          type="button"
          role="tab"
          aria-selected={mode === "microphone"}
          className={`stop-capture__mode${mode === "microphone" ? " is-active" : ""}`}
          onClick={() => setMode("microphone")}
          disabled={busy}
        >
          <Mic size={15} aria-hidden="true" /> Microphone
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "file"}
          className={`stop-capture__mode${mode === "file" ? " is-active" : ""}`}
          onClick={() => setMode("file")}
          disabled={busy}
        >
          <Upload size={15} aria-hidden="true" /> Audio file
        </button>
      </div>

      {mode === "microphone" ? (
        <Recorder
          maxSeconds={180}
          onRecorded={(recordedFile) => setFile(recordedFile)}
        />
      ) : (
        <div className="stop-file-drop">
          <FileAudio size={20} aria-hidden="true" />
          <p>
            <label htmlFor={`stop-file-${stop.id}`} className="text-link">
              Choose a WAV, FLAC, MP3 or Ogg file
            </label>{" "}
            from this device.
          </p>
          <input
            ref={inputRef}
            id={`stop-file-${stop.id}`}
            type="file"
            accept=".wav,.flac,.mp3,.ogg,audio/wav,audio/flac,audio/mpeg,audio/ogg"
            onChange={(event) => chooseFile(event.currentTarget.files?.[0])}
          />
          {file && (
            <p className="stop-file-drop__chosen">
              {file.name} · {(file.size / (1024 * 1024)).toFixed(1)} MB
            </p>
          )}
        </div>
      )}

      {file && (
        <p className="stop-capture__ready" role="status">
          <FileAudio size={14} aria-hidden="true" /> {file.name} is ready to
          save.
        </p>
      )}

      <RemoteProcessingNotice
        accepted={remoteAccepted}
        onChange={setRemoteAccepted}
      />

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      <div className="stop-capture__actions">
        <button
          type="button"
          className="button button--primary button--small"
          onClick={() => void submit()}
          disabled={
            !file || busy || (isServerProcessing() && !remoteAccepted)
          }
        >
          {busy ? (
            <Loader2 className="spin" size={14} aria-hidden="true" />
          ) : (
            <Upload size={14} aria-hidden="true" />
          )}
          {busy ? "Saving…" : "Save this recording"}
        </button>
        <p>
          The recording is saved before the sound search begins. If it fails, the clip is kept.
        </p>
      </div>
    </div>
  );
}
