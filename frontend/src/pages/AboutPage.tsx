import { useState } from "react";
import {
  AlertTriangle,
  Check,
  Cpu,
  Database,
  Download,
  HardDrive,
  Loader2,
  Lock,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Trash2,
  Waves,
  WifiOff,
} from "lucide-react";
import { api, isRemoteApi } from "../api";
import { useDocumentTitle, useResource } from "../hooks";
import { Breadcrumbs, PageHeader } from "../components/PageHeader";
import { ErrorPanel, LoadingPanel } from "../components/States";
import {
  useOnDeviceAI,
  type OnDevicePhase,
} from "../ondevice/OnDeviceAI";
import { formatBytes } from "../ondevice/config";

function aiStatusLabel(phase: OnDevicePhase, resume = false): string {
  switch (phase) {
    case "ready":
      return "AI ready";
    case "downloaded":
      return "Downloaded";
    case "downloading":
      return "Downloading";
    case "loading":
      return "Loading";
    case "testing":
      return "Testing";
    case "unsupported":
      return "Not supported";
    case "error":
      return "Needs attention";
    case "checking":
      return "Checking";
    default:
      return resume ? "Download paused" : "Not downloaded";
  }
}

function aiDescription(phase: OnDevicePhase, resume = false): string {
  switch (phase) {
    case "checking":
      return "Checking whether this browser can run the model.";
    case "unsupported":
      return "This browser cannot run the on-device model. Recording, sound finding, maps, comparisons, and plain readings still work.";
    case "not-downloaded":
      return resume
        ? "The download was paused. Resume when you are ready; parts already saved in this browser are reused."
        : "Download the model once to write reflections in this browser. It runs on your graphics card and does not send your audio or atlas to a model service.";
    case "downloading":
      return "The model is downloading into this browser's cache. You can cancel and resume later.";
    case "loading":
      return "The model is loading into graphics memory.";
    case "testing":
      return "Running a real test inference before calling the model ready.";
    case "downloaded":
      return "The model is downloaded. It will load when you ask for a reflection.";
    case "ready":
      return "The model is loaded and passed a real test inference. Reflections are written in this browser.";
    case "error":
      return "The model could not start. Your archive and plain readings still work.";
    default:
      return "";
  }
}

export function AboutPage() {
  useDocumentTitle("About");
  const models = useResource("models:about", () => api.models());
  const ai = useOnDeviceAI();
  const [confirmRemove, setConfirmRemove] = useState(false);

  const audio = models.data?.audio;
  const audioLabel =
    audio?.status === "ready"
      ? "Ready"
      : audio?.status === "error"
        ? "Error"
        : "Not installed";
  const aiStateClass =
    ai.phase === "ready" || ai.phase === "downloaded"
      ? "model-state--ready"
      : ai.phase === "unsupported"
        ? "model-state--not_installed"
        : ai.phase === "error"
          ? "model-state--error"
          : "model-state--working";
  const showProgress =
    ai.phase === "downloading" ||
    ai.phase === "loading" ||
    ai.phase === "testing";

  const refreshEverything = () => {
    models.refresh();
    void ai.refresh();
  };

  return (
    <div className="shell page about-page">
      <Breadcrumbs
        items={[{ label: "My atlas", to: "/archive" }, { label: "About" }]}
      />

      <PageHeader
        eyebrow="About Hush Atlas"
        title="A quieter way to notice."
        lede={
          <p>
            Hush Atlas helps you record the sounds around you, see what stands
            out, and return to compare.{" "}
            {isRemoteApi()
              ? "Your atlas is stored on the Hush Atlas server, and recordings you add are uploaded for analysis."
              : "Everything stays on this device."}
          </p>
        }
      />

      <section className="manifesto" aria-labelledby="manifesto-title">
        <div className="manifesto__lead">
          <p className="eyebrow">Why it exists</p>
          <h2 id="manifesto-title">A record, not a conclusion.</h2>
        </div>
        <div className="manifesto__body">
          <p>
            A quiet place is hard to notice changing. A recording is not. Hush
            Atlas keeps {isRemoteApi() ? "a" : "a local"} record of the sounds
            around a place, then shows what changed when you return.
          </p>
          <p>
            The sound reader is a helper, not a witness. It names broad sound
            types and misses context. We keep those limits visible beside every
            result.
          </p>
        </div>
        <blockquote>“What you heard is not proof of what is missing.”</blockquote>
      </section>

      <section className="section about-method" aria-labelledby="method-title">
        <header className="section-heading">
          <div>
            <p className="eyebrow">How it works</p>
            <h2 id="method-title">Four simple steps</h2>
          </div>
        </header>
        <div className="about-method__grid">
          <article>
            <span className="about-method__number tabular">01</span>
            <h3>Keep the recording</h3>
            <p>
              {isRemoteApi()
                ? "Your audio is uploaded to the Hush Atlas server and kept there with its details, results, and comparisons."
                : "Your audio stays in a folder on this device. The atlas keeps the details, results, and comparisons beside it."}
            </p>
          </article>
          <article>
            <span className="about-method__number tabular">02</span>
            <h3>Find the sounds</h3>
            <p>
              A sound reader listens in short moments and names what it hears.
              The result is a rough list of sound types, not a species count.
            </p>
          </article>
          <article>
            <span className="about-method__number tabular">03</span>
            <h3>Compare two visits</h3>
            <p>
              Each recording counts once. We compare how often a sound was found
              earlier and recently, then show the difference.
            </p>
          </article>
          <article>
            <span className="about-method__number tabular">04</span>
            <h3>Ask for a reflection, if you like</h3>
            <p>
              An on-device model can turn the result into a short paragraph. It
              runs in your browser, never changes the numbers, and stays off
              until you download it. Without it, you still get a plain reading.
            </p>
          </article>
        </div>
      </section>

      <section className="section privacy-band" aria-labelledby="privacy-title">
        <div>
          <p className="eyebrow">Privacy</p>
          <h2 id="privacy-title">
            {isRemoteApi()
              ? "No account. No third-party AI. No tracking."
              : "No account. No cloud inference. No tracking."}
          </h2>
        </div>
        <div className="privacy-band__items">
          <span>
            <ShieldCheck size={18} aria-hidden="true" />{" "}
            {isRemoteApi()
              ? "Audio is sent to your Hush Atlas server"
              : "Sound stays on this device"}
          </span>
          <span>
            <Database size={18} aria-hidden="true" />{" "}
            {isRemoteApi()
              ? "Your atlas is stored on the server"
              : "Your atlas is stored here"}
          </span>
          <span>
            <WifiOff size={18} aria-hidden="true" /> No remote fonts or tracking
          </span>
          <span>
            <Lock size={18} aria-hidden="true" /> The on-device AI model runs in
            this browser
          </span>
        </div>
      </section>

      <section
        className="section models-section"
        id="local-models"
        aria-labelledby="models-title"
      >
        <header className="section-heading">
          <div>
            <p className="eyebrow">
              {isRemoteApi() ? "Server and browser" : "On this device"}
            </p>
            <h2 id="models-title">The tools that run here</h2>
            <p className="section-heading__lede">
              {isRemoteApi()
                ? "The sound reader runs on the Hush Atlas server. On-device AI is separate: it is downloaded into this browser only when you ask."
                : "The sound reader is checked from the server running here. On-device AI is separate: it is downloaded into this browser only when you ask."}
            </p>
          </div>
          <button
            type="button"
            className="button button--ghost button--small"
            onClick={refreshEverything}
            disabled={models.loading || ai.phase === "checking"}
          >
            {models.loading || ai.phase === "checking" ? (
              <Loader2 className="spin" size={14} aria-hidden="true" />
            ) : (
              <RefreshCw size={14} aria-hidden="true" />
            )}
            Check again
          </button>
        </header>

        {models.loading ? (
          <LoadingPanel label="Checking the sound reader" />
        ) : models.error ? (
          <ErrorPanel
            title="Could not check the sound reader"
            message={models.error}
            onRetry={models.refresh}
          />
        ) : models.data ? (
          <div className="offline-banner">
            {models.data.offline_ready ? (
              <Check size={17} aria-hidden="true" />
            ) : (
              <AlertTriangle size={17} aria-hidden="true" />
            )}
            <div>
              <strong>
                {models.data.offline_ready
                  ? isRemoteApi()
                    ? "The sound reader is ready"
                    : "Finding sounds works offline"
                  : "Finding sounds is not ready yet"}
              </strong>
              <p>
                {isRemoteApi()
                  ? "YAMNet runs on the Hush Atlas server. Each recording is uploaded to it for analysis."
                  : models.data.offline_detail}
              </p>
            </div>
          </div>
        ) : null}

        <div className="model-grid">
          {models.data && (
            <article className="model-card">
              <header>
                <span className="model-card__icon" aria-hidden="true">
                  <Waves size={19} />
                </span>
                <div>
                  <p className="eyebrow">Sound reader</p>
                  <h3>YAMNet</h3>
                </div>
                <span
                  className={`model-state model-state--${audio?.status ?? "not_installed"}`}
                >
                  {audioLabel}
                </span>
              </header>
              <p>{audio?.detail}</p>
              <dl className="model-facts">
                <div>
                  <dt>Sound list</dt>
                  <dd>
                    {audio?.class_count
                      ? `${audio.class_count} sound types`
                      : "Not loaded"}
                  </dd>
                </div>
                <div>
                  <dt>Version</dt>
                  <dd>{audio?.model_version ?? "Unknown"}</dd>
                </div>
                <div>
                  <dt>Sound reader files</dt>
                  <dd>{audio?.weights_present ? "Yes" : "No"}</dd>
                </div>
                <div>
                  <dt>Sound list file</dt>
                  <dd>{audio?.class_map_present ? "Yes" : "No"}</dd>
                </div>
                <div>
                  <dt>Setup</dt>
                  <dd>{audio?.dependencies_present ? "Ready" : "Unavailable"}</dd>
                </div>
                <div>
                  <dt>Starts</dt>
                  <dd>{audio?.loaded ? "Loaded" : "On first use"}</dd>
                </div>
              </dl>
              {(audio?.weights_sha256 || audio?.class_map_sha256) && (
                <details className="hash-details">
                  <summary>File checksums</summary>
                  <code>yamnet.h5 · {audio?.weights_sha256 ?? "not checked"}</code>
                  <code>
                    sound list · {audio?.class_map_sha256 ?? "not checked"}
                  </code>
                </details>
              )}
            </article>
          )}

          <article className="model-card model-card--ondevice" id="on-device-ai">
            <header>
              <span className="model-card__icon" aria-hidden="true">
                <Sparkles size={19} />
              </span>
              <div>
                <p className="eyebrow">On-device AI</p>
                <h3>Gemma 2 · 2B</h3>
              </div>
              <span className={`model-state ${aiStateClass}`}>
                {aiStatusLabel(ai.phase, ai.resume)}
              </span>
            </header>
            <p>{aiDescription(ai.phase, ai.resume)}</p>
            <dl className="model-facts">
              <div>
                <dt>Model</dt>
                <dd>Gemma 2 2B · 4-bit</dd>
              </div>
              <div>
                <dt>Download</dt>
                <dd>{formatBytes(ai.model.downloadBytes)}</dd>
              </div>
              <div>
                <dt>Memory</dt>
                <dd>
                  About {formatBytes(ai.model.vramMb * 1024 * 1024)} VRAM
                </dd>
              </div>
              <div>
                <dt>Context</dt>
                <dd>{ai.model.contextWindow.toLocaleString()} tokens</dd>
              </div>
              <div>
                <dt>Runtime</dt>
                <dd>{ai.model.runtime}</dd>
              </div>
              <div>
                <dt>Storage</dt>
                <dd>
                  {ai.cached
                    ? "Downloaded in this browser"
                    : ai.resume
                      ? "Browser cache, partial download"
                      : "Browser cache, not downloaded"}
                </dd>
              </div>
            </dl>

            {ai.support.adapterName && (
              <p className="model-card__adapter">
                Graphics adapter: {ai.support.adapterName}
              </p>
            )}

            {ai.support.status === "unsupported" && (
              <div className="ondevice-note ondevice-note--warning">
                <AlertTriangle size={16} aria-hidden="true" />
                <div>
                  <strong>This browser cannot run the on-device model.</strong>
                  <p>{ai.support.reason}</p>
                  <p>
                    Recording, sound finding, maps, comparisons, and plain
                    readings still work.
                  </p>
                </div>
              </div>
            )}

            {ai.phase === "not-downloaded" && (
              <div className="ondevice-note">
                <Download size={16} aria-hidden="true" />
                <div>
                  <strong>One-time download</strong>
                  <p>
                    About {formatBytes(ai.model.downloadBytes)} is downloaded
                    from Hugging Face and stored in this browser&apos;s cache.
                    The model download does not send your audio, recordings, or
                    atlas data.{" "}
                    {isRemoteApi()
                      ? "Recordings you add for sound analysis are uploaded separately to the Hush Atlas server."
                      : ""}{" "}
                    The download starts only when you choose it.
                  </p>
                </div>
              </div>
            )}

            {showProgress && (
              <div className="ondevice-progress" aria-live="polite">
                <div className="ondevice-progress__label">
                  <span>{ai.progress?.text ?? "Preparing the model…"}</span>
                  <span className="tabular">
                    {Math.round((ai.progress?.value ?? 0) * 100)}%
                  </span>
                </div>
                <progress
                  max={1}
                  value={ai.progress?.value ?? 0}
                  aria-label="On-device AI progress"
                />
                <p>
                  Keep this tab open. The model is stored in this browser and a
                  stopped download can be resumed.
                </p>
                <button
                  type="button"
                  className="button button--ghost button--small"
                  onClick={ai.cancel}
                >
                  Cancel
                </button>
              </div>
            )}

            {ai.error && (
              <p className="form-error" role="alert">
                {ai.error}
              </p>
            )}

            <div className="model-card__actions">
              {ai.phase === "ready" && (
                <span className="ondevice-ready">
                  <Check size={15} aria-hidden="true" /> AI ready
                </span>
              )}

              {(ai.phase === "not-downloaded" ||
                (ai.phase === "error" && !ai.cached)) && (
                <button
                  type="button"
                  className="button button--primary button--small"
                  onClick={() => void ai.download()}
                >
                  <Download size={14} aria-hidden="true" />
                  {ai.resume ? "Resume download" : "Download model"}
                </button>
              )}

              {(ai.phase === "downloaded" ||
                (ai.phase === "error" && ai.cached)) && (
                <button
                  type="button"
                  className="button button--primary button--small"
                  onClick={() => void ai.prepare()}
                >
                  <Sparkles size={14} aria-hidden="true" />
                  {ai.phase === "error" ? "Try again" : "Start AI"}
                </button>
              )}

              {ai.support.status === "unsupported" && (
                <button
                  type="button"
                  className="button button--ghost button--small"
                  onClick={() => void ai.refresh()}
                >
                  <RefreshCw size={14} aria-hidden="true" />
                  Check again
                </button>
              )}

              {(ai.cached || ai.phase === "ready") &&
                !confirmRemove &&
                !showProgress && (
                  <button
                    type="button"
                    className="button button--ghost button--small"
                    onClick={() => setConfirmRemove(true)}
                  >
                    <Trash2 size={14} aria-hidden="true" />
                    Remove downloaded model
                  </button>
                )}
            </div>

            {confirmRemove && (
              <div className="ondevice-confirm">
                <p>
                  Remove the downloaded model from this browser? Saved
                  reflections stay in your atlas.
                </p>
                <div>
                  <button
                    type="button"
                    className="button button--danger button--small"
                    onClick={() => {
                      setConfirmRemove(false);
                      void ai.remove();
                    }}
                  >
                    Remove model
                  </button>
                  <button
                    type="button"
                    className="button button--ghost button--small"
                    onClick={() => setConfirmRemove(false)}
                  >
                    Keep model
                  </button>
                </div>
              </div>
            )}

            <p className="model-card__caveat">
              Reflections are optional words, not evidence. The model never
              computes a rate or a comparison. Its text is rejected if it adds
              unsupported causes, dates, numbers, or claims of permanence.
            </p>
          </article>
        </div>
      </section>

      <section className="section limits-section" aria-labelledby="limits-title">
        <header className="section-heading">
          <div>
            <p className="eyebrow">Limits</p>
            <h2 id="limits-title">What this cannot tell you</h2>
          </div>
        </header>
        <div className="limits-grid">
          <div>
            <h3>Sound names are broad</h3>
            <p>
              The sound reader uses broad names like “Bird” or “Vehicle.” It does
              not identify species, and a missing name does not prove a sound was
              absent.
            </p>
          </div>
          <div>
            <h3>Recordings are not a survey</h3>
            <p>
              Groups are chosen from what you recorded. Microphone, placement,
              weather, time of day, and length all shape the result. We do not
              correct for them.
            </p>
          </div>
          <div>
            <h3>A difference has no cause here</h3>
            <p>
              A difference in rates is a difference in what the sound reader
              found. It does not explain why, and it does not prove permanent
              loss.
            </p>
          </div>
          <div>
            <h3>Words can embellish</h3>
            <p>
              Written reflections are checked, but an on-device model can still
              be wrong. Plain readings avoid that layer and are labelled.
            </p>
          </div>
        </div>
      </section>

      <section className="section about-facts" aria-labelledby="facts-title">
        <div>
          <p className="eyebrow">Built in the open</p>
          <h2 id="facts-title">What it is built with</h2>
          <p>
            A React interface, a FastAPI service, SQLite storage, TensorFlow
            YAMNet, and WebLLM Gemma in the browser. No account, no third-party
            AI service, no hidden API key.
          </p>
        </div>
        <div className="about-facts__grid">
          <span>
            <Cpu size={16} aria-hidden="true" /> React 19 · Vite · TypeScript
          </span>
          <span>
            <Database size={16} aria-hidden="true" /> FastAPI · SQLite · Python
          </span>
          <span>
            <Waves size={16} aria-hidden="true" /> YAMNet · TensorFlow · NumPy
          </span>
          <span>
            <HardDrive size={16} aria-hidden="true" /> WebLLM · WebGPU · browser
            cache
          </span>
        </div>
        <p className="about-facts__license">
          YAMNet is used under the Apache License 2.0 and is part of TensorFlow
          Models. AudioSet is a Google ontology; no AudioSet audio is included.
          Gemma 2 is used under the Gemma Terms of Use, and WebLLM is Apache
          2.0. The sample audio is synthesized for the demo.
        </p>
      </section>
    </div>
  );
}
