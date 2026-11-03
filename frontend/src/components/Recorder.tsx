import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { Mic, RotateCcw, Square } from "lucide-react";
import {
  encodeWav,
  peaksFromChunks,
  recordingFileName,
} from "../audioRecording";
import { formatDuration, MAX_RECORDING_SECONDS } from "../utils";
import { Spinner } from "./States";
import { Waveform } from "./Waveform";

const WORKLET_SOURCE = `
class SilenceTap extends AudioWorkletProcessor {
  process(inputs) {
    const channels = inputs[0];
    if (!channels || channels.length === 0) return true;
    const length = channels[0].length;
    const mono = new Float32Array(length);
    for (let channel = 0; channel < channels.length; channel += 1) {
      const data = channels[channel];
      for (let index = 0; index < length; index += 1) {
        mono[index] += data[index];
      }
    }
    if (channels.length > 1) {
      for (let index = 0; index < length; index += 1) {
        mono[index] /= channels.length;
      }
    }
    this.port.postMessage(mono.buffer, [mono.buffer]);
    return true;
  }
}
registerProcessor("silence-tap", SilenceTap);
`;

const BAND_COUNT = 32;

interface CaptureRuntime {
  context: AudioContext;
  stream: MediaStream;
  source: MediaStreamAudioSourceNode;
  analyser: AnalyserNode;
  worklet: AudioWorkletNode | null;
  processor: ScriptProcessorNode | null;
  gain: GainNode;
  chunks: Float32Array[];
  frames: number;
  sampleRate: number;
  startedAt: number;
  timer: number;
  animation: number;
}

type Phase = "idle" | "requesting" | "recording" | "encoding" | "ready" | "error";

function emptyBands(): number[] {
  return new Array<number>(BAND_COUNT).fill(0);
}

function microphoneError(error: unknown): string {
  if (error instanceof DOMException) {
    switch (error.name) {
      case "NotAllowedError":
      case "SecurityError":
        return "Microphone access was refused. Allow microphone use for this page in your browser, then try again.";
      case "NotFoundError":
        return "No microphone was found on this device. Connect one, or upload an audio file instead.";
      case "NotReadableError":
        return "The microphone is already in use by another application. Close it there and try again.";
      default:
        return `The microphone could not be opened (${error.name}). You can upload a recording instead.`;
    }
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return "The microphone could not be opened. You can upload a recording instead.";
}

function insecurePageHint(): string | null {
  if (window.isSecureContext) {
    return null;
  }
  const { hostname, port } = window.location;
  const address = port ? `${hostname}:${port}` : hostname;
  return `Recording needs a secure page. Open https://${address} on this device, or upload a sound file instead.`;
}

async function releaseRuntime(state: CaptureRuntime): Promise<void> {
  window.clearInterval(state.timer);
  window.cancelAnimationFrame(state.animation);
  for (const track of state.stream.getTracks()) {
    track.stop();
  }
  try {
    state.source.disconnect();
    state.analyser.disconnect();
    state.worklet?.disconnect();
    state.processor?.disconnect();
    state.gain.disconnect();
  } catch {
    // Nodes may already be disconnected during a browser-level interruption.
  }
  try {
    await state.context.close();
  } catch {
    // A closed or interrupted context needs no further cleanup.
  }
}

export function Recorder({
  onRecorded,
  maxSeconds = MAX_RECORDING_SECONDS,
}: {
  onRecorded: (file: File | null, duration: number) => void;
  maxSeconds?: number;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [bands, setBands] = useState<number[]>(emptyBands);
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [finalDuration, setFinalDuration] = useState(0);
  const [previewPeaks, setPreviewPeaks] = useState<number[]>([]);
  const runtimeRef = useRef<CaptureRuntime | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      const current = runtimeRef.current;
      runtimeRef.current = null;
      if (current) {
        void releaseRuntime(current);
      }
    };
  }, []);

  const finishCapture = useCallback(async () => {
    const state = runtimeRef.current;
    if (!state) {
      return;
    }
    runtimeRef.current = null;
    const duration = state.frames / state.sampleRate;
    setElapsed(duration);
    setPhase("encoding");
    setBands(emptyBands());
    await releaseRuntime(state);
    await new Promise((resolve) => window.setTimeout(resolve, 40));
    if (!mountedRef.current) {
      return;
    }
    if (!Number.isFinite(duration) || duration < 1) {
      setError("That recording was shorter than one second. Try again.");
      setPhase("error");
      onRecorded(null, 0);
      return;
    }

    try {
      const blob = encodeWav(state.chunks, state.sampleRate);
      const recordedFile = new File([blob], recordingFileName(), {
        type: "audio/wav",
        lastModified: Date.now(),
      });
      setFile(recordedFile);
      setFinalDuration(duration);
      setPreviewPeaks(peaksFromChunks(state.chunks));
      setPhase("ready");
      onRecorded(recordedFile, duration);
    } catch {
      setError("The browser could not encode this recording as WAV. Try again.");
      setPhase("error");
      onRecorded(null, 0);
    }
  }, [onRecorded]);

  useEffect(() => {
    if (phase === "recording" && elapsed >= maxSeconds) {
      void finishCapture();
    }
  }, [phase, elapsed, maxSeconds, finishCapture]);

  const startCapture = async () => {
    setError(null);
    setFile(null);
    setPreviewPeaks([]);
    setFinalDuration(0);
    onRecorded(null, 0);
    setPhase("requesting");
    setElapsed(0);
    setBands(emptyBands());

    const insecureHint = insecurePageHint();
    if (insecureHint) {
      setError(insecureHint);
      setPhase("error");
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setError(
        "This browser does not expose microphone capture. Upload a WAV, FLAC, MP3, or Ogg file instead.",
      );
      setPhase("error");
      return;
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
    } catch (permissionError) {
      if (mountedRef.current) {
        setError(microphoneError(permissionError));
        setPhase("error");
      }
      return;
    }

    if (!mountedRef.current) {
      for (const track of stream.getTracks()) {
        track.stop();
      }
      return;
    }

    const ContextClass =
      window.AudioContext ??
      (window as typeof window & { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!ContextClass) {
      for (const track of stream.getTracks()) {
        track.stop();
      }
      setError(
        "This browser does not support Web Audio capture. Upload an audio file instead.",
      );
      setPhase("error");
      return;
    }

    let context: AudioContext;
    try {
      context = new ContextClass();
      await context.resume();
    } catch {
      for (const track of stream.getTracks()) {
        track.stop();
      }
      setError("The audio engine could not start in this browser.");
      setPhase("error");
      return;
    }

    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.72;
    const gain = context.createGain();
    gain.gain.value = 0;
    source.connect(analyser);
    analyser.connect(gain);
    gain.connect(context.destination);

    const state: CaptureRuntime = {
      context,
      stream,
      source,
      analyser,
      worklet: null,
      processor: null,
      gain,
      chunks: [],
      frames: 0,
      sampleRate: context.sampleRate,
      startedAt: performance.now(),
      timer: 0,
      animation: 0,
    };

    const collect = (samples: Float32Array) => {
      if (runtimeRef.current !== state) {
        return;
      }
      state.chunks.push(samples);
      state.frames += samples.length;
    };

    let tapsConnected = false;
    if (context.audioWorklet) {
      let moduleUrl: string | null = null;
      try {
        moduleUrl = URL.createObjectURL(
          new Blob([WORKLET_SOURCE], { type: "application/javascript" }),
        );
        await context.audioWorklet.addModule(moduleUrl);
        const worklet = new AudioWorkletNode(context, "silence-tap", {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          outputChannelCount: [1],
          channelCount: 1,
          channelCountMode: "explicit",
        });
        worklet.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
          collect(new Float32Array(event.data));
        };
        source.connect(worklet);
        worklet.connect(gain);
        state.worklet = worklet;
        tapsConnected = true;
      } catch {
        tapsConnected = false;
      } finally {
        if (moduleUrl) {
          URL.revokeObjectURL(moduleUrl);
        }
      }
    }

    if (!tapsConnected) {
      const processor = context.createScriptProcessor(4096, 1, 1);
      processor.onaudioprocess = (event) => {
        const channel = event.inputBuffer.getChannelData(0);
        const samples = new Float32Array(channel.length);
        samples.set(channel);
        collect(samples);
      };
      source.connect(processor);
      processor.connect(gain);
      state.processor = processor;
    }

    runtimeRef.current = state;
    if (!mountedRef.current) {
      runtimeRef.current = null;
      await releaseRuntime(state);
      return;
    }

    state.timer = window.setInterval(() => {
      if (runtimeRef.current !== state) {
        return;
      }
      setElapsed(Math.min(maxSeconds, (performance.now() - state.startedAt) / 1000));
    }, 200);

    const frequency = new Uint8Array(analyser.frequencyBinCount);
    let lastMeterUpdate = 0;
    const drawMeter = (now: number) => {
      if (runtimeRef.current !== state) {
        return;
      }
      if (now - lastMeterUpdate > 85) {
        lastMeterUpdate = now;
        analyser.getByteFrequencyData(frequency);
        const usableBins = Math.min(frequency.length, 380);
        const step = Math.max(1, Math.floor(usableBins / BAND_COUNT));
        const next = new Array<number>(BAND_COUNT).fill(0);
        for (let band = 0; band < BAND_COUNT; band += 1) {
          let total = 0;
          let count = 0;
          for (
            let bin = band * step;
            bin < Math.min(usableBins, (band + 1) * step);
            bin += 1
          ) {
            total += frequency[bin];
            count += 1;
          }
          const value = count ? total / count / 255 : 0;
          next[band] = Math.min(1, Math.pow(value, 0.7) * 1.7);
        }
        setBands((previous) =>
          next.map((value, index) =>
            Math.max(value, (previous[index] ?? 0) * 0.62),
          ),
        );
      }
      state.animation = window.requestAnimationFrame(drawMeter);
    };
    state.animation = window.requestAnimationFrame(drawMeter);
    setPhase("recording");
  };

  const reset = () => {
    setPhase("idle");
    setFile(null);
    setPreviewPeaks([]);
    setFinalDuration(0);
    setElapsed(0);
    setError(null);
    setBands(emptyBands());
    onRecorded(null, 0);
  };

  const nearLimit = phase === "recording" && elapsed >= maxSeconds - 15;

  return (
    <div className="recorder">
      <div className="recorder__head">
        <div>
          <p className="eyebrow">Recorder</p>
          <h3>Record from this device</h3>
        </div>
        <span className="recorder__limit">Up to {formatDuration(maxSeconds)}</span>
      </div>

      {phase === "idle" && (
        <div className="recorder__idle">
          <button
            type="button"
            className="record-button"
            onClick={() => void startCapture()}
          >
            <Mic size={20} aria-hidden="true" />
            Start recording
          </button>
          <p>
            {insecurePageHint() ??
              "The browser will ask for microphone access. Audio stays in this tab until you save it."}
          </p>
        </div>
      )}

      {phase === "requesting" && (
        <div className="recorder__status" role="status">
          <Spinner size={20} />
          <div>
            <h4>Waiting for permission</h4>
            <p>Allow microphone access to begin.</p>
          </div>
        </div>
      )}

      {phase === "recording" && (
        <div className="recorder__live">
          <div className="recorder__live-top">
            <span className="record-indicator" aria-hidden="true" />
            <span className="recorder__timer" role="timer" aria-label="Recording duration">
              {formatDuration(elapsed)}
            </span>
            <button
              type="button"
              className="button button--danger button--small"
              onClick={() => void finishCapture()}
            >
              <Square size={12} fill="currentColor" aria-hidden="true" />
              Stop &amp; use
            </button>
          </div>
          <div className="recorder__meter" aria-hidden="true">
            {bands.map((value, index) => (
              <span
                key={index}
                style={{ transform: `scaleY(${Math.max(0.035, value)})` }}
              />
            ))}
          </div>
          <p className="recorder__live-note" aria-live="polite">
            {nearLimit
              ? "Almost at the three-minute limit. Recording will stop by itself."
              : "Recording. Keep this tab open until you stop."}
          </p>
        </div>
      )}

      {phase === "encoding" && (
        <div className="recorder__status" role="status">
          <Spinner size={20} />
          <div>
            <h4>Preparing the recording</h4>
            <p>This can take a moment.</p>
          </div>
        </div>
      )}

      {phase === "ready" && file && (
        <div className="recorder__ready">
          <div className="recorder__ready-head">
            <div>
              <span className="badge badge--sage">Ready</span>
              <h4>{formatDuration(finalDuration)} recorded</h4>
            </div>
            <button
              type="button"
              className="button button--ghost button--small"
              onClick={reset}
            >
              <RotateCcw size={14} aria-hidden="true" />
              Record again
            </button>
          </div>
          <Waveform peaks={previewPeaks} progress={1} bars={150} quiet />
          <p>
            Your recording is ready. The title and notes below will be saved with it.
          </p>
        </div>
      )}

      {phase === "error" && (
        <div className="recorder__error" role="alert">
          <p>{error}</p>
          <button
            type="button"
            className="button button--ghost button--small"
            onClick={() => void startCapture()}
          >
            <Mic size={14} aria-hidden="true" />
            Try again
          </button>
        </div>
      )}
    </div>
  );
}
