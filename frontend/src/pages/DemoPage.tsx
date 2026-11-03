import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  Check,
  FlaskConical,
  Loader2,
  Mic,
  RefreshCw,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { api, isRemoteApi } from "../api";
import {
  formatDate,
  getErrorMessage,
  pluralize,
} from "../utils";
import {
  useDocumentTitle,
  usePolling,
  useResource,
} from "../hooks";
import { Breadcrumbs, PageHeader } from "../components/PageHeader";
import { ErrorPanel, LoadingPanel, Spinner } from "../components/States";
import { StatusBadge } from "../components/StatusBadge";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { useToast } from "../components/Toast";

export function DemoPage() {
  useDocumentTitle("Sample atlas");
  const { push } = useToast();
  const demo = useResource("demo", () => api.demo());
  const models = useResource("models:demo", () => api.models());
  const [preparing, setPreparing] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [removing, setRemoving] = useState(false);
  const previousStatus = useRef<string | null>(null);

  const status = demo.data?.status ?? null;
  usePolling(() => demo.refresh(), status === "preparing" ? 2500 : null);

  useEffect(() => {
    if (
      previousStatus.current === "preparing" &&
      status === "ready"
    ) {
      push("The sample is ready.", "success");
    }
    if (
      previousStatus.current === "preparing" &&
      status === "failed"
    ) {
      push("The sample could not be prepared.", "error");
    }
    previousStatus.current = status;
  }, [status, push]);

  const audioReady = models.data?.audio.status === "ready";
  const modelStatusLoading = models.loading && !models.data;

  const prepare = async () => {
    setPreparing(true);
    try {
      const next = await api.prepareDemo();
      push(
        next.status === "ready"
          ? "The sample is ready."
          : "Making sample recordings and finding their sounds.",
        "info",
      );
      demo.refresh();
    } catch (error) {
      push(getErrorMessage(error), "error");
    } finally {
      setPreparing(false);
    }
  };

  const remove = async () => {
    setRemoving(true);
    try {
      const result = await api.removeDemo();
      push(result.message, "success");
      setRemoveOpen(false);
      demo.refresh();
    } catch (error) {
      push(getErrorMessage(error), "error");
    } finally {
      setRemoving(false);
    }
  };

  return (
    <div className="shell page demo-page">
      <Breadcrumbs
        items={[{ label: "My atlas", to: "/archive" }, { label: "Sample atlas" }]}
      />

      <PageHeader
        eyebrow="A sample to explore"
        title="See how it works."
        lede={
          <p>
            Four made-up soundscapes, run through the same analysis as real
            recordings. The audio is invented; the results are real.
          </p>
        }
        actions={
          demo.data?.status === "ready" ? (
            <button
              type="button"
              className="button button--danger button--small"
              onClick={() => setRemoveOpen(true)}
            >
              <Trash2 size={14} aria-hidden="true" />
              Remove sample
            </button>
          ) : undefined
        }
      />

      <section className="demo-facts" aria-label="About this sample">
        <div>
          <span className="demo-facts__icon" aria-hidden="true">
            <FlaskConical size={18} />
          </span>
          <div>
            <h2>Made-up audio</h2>
            <p>
              Chirps, wind, rain, and traffic are generated in software. None of it is a real field recording.
            </p>
          </div>
        </div>
        <div>
          <span className="demo-facts__icon" aria-hidden="true">
            <Mic size={18} />
          </span>
          <div>
            <h2>Real results</h2>
            <p>
              The same sound reader runs on these files. Matches, moments, and
              comparisons are real output.
            </p>
          </div>
        </div>
        <div>
          <span className="demo-facts__icon" aria-hidden="true">
            <Check size={18} />
          </span>
          <div>
            <h2>Kept separate</h2>
            <p>
              The sample has its own place and is left out of your counts. Removing it will not touch your recordings.
            </p>
          </div>
        </div>
      </section>

      {demo.loading ? (
        <LoadingPanel label="Checking the sample" />
      ) : demo.error ? (
        <ErrorPanel
          title="Could not check the sample"
          message={demo.error}
          onRetry={demo.refresh}
        />
      ) : !demo.data ? null : demo.data.status === "preparing" ? (
        <section className="demo-preparing" aria-live="polite">
          <div className="demo-preparing__top">
            <Spinner size={24} />
            <div>
              <p className="eyebrow">Getting it ready</p>
              <h2>Making sounds. Finding sounds. Comparing.</h2>
              <p>{demo.data.detail}</p>
            </div>
          </div>
          <div className="demo-preparing__bar" aria-hidden="true">
            <span />
          </div>
          <ol>
            <li>Make four 30-second sample recordings.</li>
            <li>Find the sounds in each recording.</li>
            <li>Save the results and make a comparison.</li>
          </ol>
          <p className="section-note">
            This can take a little while. The page checks again by itself, so you can leave it open.
          </p>
        </section>
      ) : demo.data.status === "failed" ? (
        <section className="demo-failed" role="alert">
          <TriangleAlert size={22} aria-hidden="true" />
          <div>
            <h2>The sample could not be prepared.</h2>
            <p>{demo.data.detail}</p>
            <button
              type="button"
              className="button button--primary button--small"
              onClick={() => void prepare()}
              disabled={preparing || modelStatusLoading || !audioReady}
            >
              {preparing ? (
                <Loader2 className="spin" size={14} aria-hidden="true" />
              ) : (
                <RefreshCw size={14} aria-hidden="true" />
              )}
              Try again
            </button>
          </div>
        </section>
      ) : demo.data.status === "ready" ? (
        <section className="demo-ready" aria-labelledby="ready-title">
          <header className="demo-ready__head">
            <div>
              <p className="eyebrow">Ready to explore</p>
              <h2 id="ready-title">
                {demo.data.place_name ?? "The Sample Courtyard"}
              </h2>
              <p>{demo.data.detail}</p>
            </div>
            <div className="demo-ready__actions">
              {demo.data.place_id && (
                <Link
                  className="button button--primary"
                  to={`/places/${demo.data.place_id}`}
                >
                  Open sample place
                  <ArrowRight size={15} aria-hidden="true" />
                </Link>
              )}
              {demo.data.comparison_id && (
                <Link
                  className="button button--ghost"
                  to={`/comparisons/${demo.data.comparison_id}`}
                >
                  See the comparison
                </Link>
              )}
              {demo.data.walk_id && (
                <Link
                  className="button button--ghost"
                  to={`/walks/${demo.data.walk_id}`}
                >
                  Open sample walk
                </Link>
              )}
            </div>
          </header>
          <div className="demo-ready__body">
            <div className="demo-recordings">
              <header>
                <span className="eyebrow">The recordings</span>
                <span>
                  {demo.data.recordings.length}{" "}
                  {pluralize(demo.data.recordings.length, "file")}
                </span>
              </header>
              <ol>
                {demo.data.recordings.map((recording, index) => (
                  <li key={recording.recording_id}>
                    <span className="tabular">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <Link
                      to={`/places/${demo.data?.place_id}/recordings/${recording.recording_id}`}
                    >
                      {recording.title}
                    </Link>
                    <span>{formatDate(recording.recorded_at)}</span>
                    <StatusBadge status={recording.status} compact />
                  </li>
                ))}
              </ol>
            </div>
            <aside className="demo-ready__aside">
              <p className="eyebrow">What to look for</p>
              <h3>A sound that fades.</h3>
              <p>
                In the comparison, the earlier recordings contain bird-like chirps. The recent ones are full of traffic. The difference is real output from the sound reader, not proof about the world.
              </p>
              {demo.data.comparison_id && (
                <Link
                  className="text-link"
                  to={`/comparisons/${demo.data.comparison_id}`}
                >
                  See what changed{" "}
                  <ArrowRight size={14} aria-hidden="true" />
                </Link>
              )}
            </aside>
          </div>
        </section>
      ) : (
        <section className="demo-absent">
          <div className="demo-absent__copy">
            <p className="eyebrow">Not made yet</p>
            <h2>Make the sample.</h2>
            <p>
              This makes four 30-second sample recordings and finds their sounds. It creates a place and a comparison without touching your own atlas.
            </p>
            <ul className="demo-checklist">
              <li>
                <span>01</span> Sample audio is synthesized, not recorded.
              </li>
              <li>
                <span>02</span> Real results are saved.
              </li>
              <li>
                <span>03</span> A comparison is made.
              </li>
            </ul>
            <button
              type="button"
              className="button button--primary"
              onClick={() => void prepare()}
              disabled={preparing || modelStatusLoading || !audioReady}
            >
              {preparing ? (
                <Loader2 className="spin" size={16} aria-hidden="true" />
              ) : (
                <FlaskConical size={16} aria-hidden="true" />
              )}
              {preparing ? "Starting…" : "Make the sample"}
            </button>
            {modelStatusLoading && (
              <span className="demo-absent__hint">Checking the sound reader…</span>
            )}
            {!modelStatusLoading && models.data && !audioReady && (
              <span className="demo-absent__hint">
                The sound reader is not ready: {models.data.audio.detail}{" "}
                <Link className="text-link" to="/about#local-models">
                  Check what is installed
                </Link>
              </span>
            )}
            {models.error && (
              <span className="demo-absent__hint">
                Could not check the sound reader: {models.error}{" "}
                <button
                  type="button"
                  className="text-button"
                  onClick={() => models.refresh()}
                >
                  Retry
                </button>
              </span>
            )}
          </div>

          <div className="demo-absent__seal" aria-hidden="true">
            <span>Sample</span>
            <strong>04</strong>
            <span>sample sounds</span>
            <span className="demo-absent__seal-mark">
              <Mic size={22} />
            </span>
          </div>
        </section>
      )}

      <section className="demo-note-panel">
        <h2>Why there is a sample</h2>
        <p>
          A sound atlas needs a past. The sample provides one without pretending the place is real. It shows how recordings become a comparison, and how a result stays separate from a claim about the world.
        </p>
        <p>
          Everything here is produced by the archive server. No third-party AI
          service, API key, or tracking.
        </p>
      </section>

      <ConfirmDialog
        open={removeOpen}
        title="Remove the sample?"
        description={
          <>
            <p>
              The sample place, its four recordings, results, and comparison
              will be removed from{" "}
              {isRemoteApi() ? "the Hush Atlas server" : "this device"}.
            </p>
            <p>Your own places and recordings will not be touched.</p>
          </>
        }
        confirmLabel="Remove sample"
        busy={removing}
        onCancel={() => setRemoveOpen(false)}
        onConfirm={() => void remove()}
      />
    </div>
  );
}
