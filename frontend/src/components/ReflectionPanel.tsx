import { useCallback, useEffect, useState } from "react";
import {
  BookOpen,
  Feather,
  Loader2,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "../api";
import type { Reflection } from "../types";
import { getErrorMessage } from "../utils";
import { useOnDeviceAI } from "../ondevice/OnDeviceAI";
import {
  buildReflectionMessages,
  validateReflection,
  type ReflectionContext,
} from "../ondevice/prompt";
import {
  readLocalReflection,
  writeLocalReflection,
  type StoredReflection,
} from "../ondevice/storage";
import { useToast } from "./Toast";

interface ReflectionPanelProps {
  comparisonId: number;
  classIndex: number;
  label: string;
  context: ReflectionContext;
}

function storedReflection(value: StoredReflection): Reflection {
  return {
    comparison_id: value.comparisonId,
    class_index: value.classIndex,
    label: value.label,
    source: "on-device",
    model_name: value.modelName,
    text: value.text,
    cached: true,
    gemma_available: true,
    warning: null,
    created_at: value.createdAt,
  };
}

export function ReflectionPanel({
  comparisonId,
  classIndex,
  label,
  context,
}: ReflectionPanelProps) {
  const [reflection, setReflection] = useState<Reflection | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const ai = useOnDeviceAI();
  const { push } = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const local = readLocalReflection(comparisonId, classIndex);
    if (local) {
      setReflection(storedReflection(local));
      setLoading(false);
      return;
    }
    try {
      const value = await api.existingReflection(comparisonId, classIndex);
      setReflection(value);
    } catch (loadError) {
      setError(getErrorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, [comparisonId, classIndex]);

  useEffect(() => {
    void load();
  }, [load]);

  const compose = async () => {
    if (generating) {
      return;
    }
    if (!ai.canWrite) {
      push(
        ai.support.status === "unsupported"
          ? "This browser cannot run the on-device model. A plain reading is still available."
          : "Set up On-device AI in About first.",
        "info",
      );
      return;
    }

    setGenerating(true);
    setError(null);
    try {
      const ready = await ai.prepare();
      if (!ready) {
        throw new Error(
          ai.error ??
            "On-device AI could not start. Open About to see what happened.",
        );
      }

      let lastFailure: unknown = null;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const messages = buildReflectionMessages(context);
        if (attempt > 0) {
          messages.push({
            role: "user",
            content:
              "Your previous reply did not pass the archive's checks. Write it again in 60-110 words, in two paragraphs. Mention what the sound reader detected. Use only the evidence and the rules above.",
          });
        }
        const raw = await ai.generate(messages, {
          maxTokens: 360,
          temperature: attempt === 0 ? 0.2 : 0.05,
        });
        try {
          const text = validateReflection(raw, context);
          const value: Reflection = {
            comparison_id: comparisonId,
            class_index: classIndex,
            label,
            source: "on-device",
            model_name: ai.model.id,
            text,
            cached: true,
            gemma_available: true,
            warning: null,
            created_at: new Date().toISOString(),
          };
          setReflection(value);
          writeLocalReflection({
            comparisonId,
            classIndex,
            label,
            text,
            modelName: ai.model.id,
            createdAt: value.created_at ?? new Date().toISOString(),
          });
          push("A reflection was written on this device.", "success");
          return;
        } catch (validationError) {
          lastFailure = validationError;
        }
      }
      throw (
        lastFailure ??
        new Error("The on-device model did not return a usable reflection.")
      );
    } catch (composeError) {
      const message = getErrorMessage(composeError);
      setError(message);
      push(message, "error");
    } finally {
      setGenerating(false);
    }
  };

  const written =
    reflection?.source === "on-device" || reflection?.source === "gemma";
  const aiAvailable = ai.canWrite;
  const aiBusy =
    ai.phase === "downloading" ||
    ai.phase === "loading" ||
    ai.phase === "testing";

  return (
    <section className="reading-panel" aria-labelledby="reading-title">
      <header className="reading-panel__header">
        <div>
          <p className="eyebrow">
            {written ? "Written on this device" : "From the numbers"}
          </p>
          <h2 id="reading-title">About {label}</h2>
        </div>
        {!loading && reflection && (
          <span
            className={`source-label${
              written ? " source-label--ondevice" : " source-label--fallback"
            }`}
          >
            {written ? <Sparkles size={14} /> : <BookOpen size={14} />}
            {written ? "On-device AI" : "Plain reading"}
          </span>
        )}
      </header>

      <div className="reading-panel__body" aria-live="polite">
        {loading && (
          <div className="reading-panel__loading">
            <Loader2 className="spin" size={18} aria-hidden="true" />
            <span>Reading the comparison…</span>
          </div>
        )}

        {!loading && error && (
          <div className="inline-error" role="alert">
            <p>{error}</p>
            <button
              type="button"
              className="text-button"
              onClick={() => void load()}
            >
              Try again
            </button>
          </div>
        )}

        {!loading && reflection && (
          <>
            <div className="reading-panel__text">
              {reflection.text.split(/\n{2,}/).map((paragraph, index) => (
                <p key={index}>{paragraph}</p>
              ))}
            </div>
            <p className="reading-panel__source-note">
              {written ? (
                <>
                  Written by{" "}
                  {reflection.model_name ?? "a model running on this device"}{" "}
                  from this comparison, then checked against its limits.{" "}
                  <strong>A language model can still be wrong.</strong>
                </>
              ) : (
                <>
                  No AI model was used. This reading is put together from the
                  comparison&apos;s numbers.
                </>
              )}
              {reflection.cached && " Saved earlier."}
            </p>
          </>
        )}
      </div>

      <footer className="reading-panel__footer">
        {reflection && (
          <div className="reading-panel__actions">
            <button
              type="button"
              className="button button--ghost button--small"
              onClick={() => void compose()}
              disabled={generating || !aiAvailable || aiBusy}
              title={
                aiAvailable
                  ? undefined
                  : ai.support.status === "unsupported"
                    ? (ai.support.reason ?? "On-device AI is not supported here.")
                    : "Download the on-device model in About."
              }
            >
              {generating || aiBusy ? (
                <Loader2 className="spin" size={15} aria-hidden="true" />
              ) : written ? (
                <RefreshCw size={15} aria-hidden="true" />
              ) : (
                <Feather size={15} aria-hidden="true" />
              )}
              {generating
                ? "Writing on this device…"
                : ai.phase === "downloading"
                  ? "AI downloading…"
                  : ai.phase === "loading" || ai.phase === "testing"
                    ? "Starting AI…"
                    : written
                      ? "Ask for a rewrite"
                      : "Write a reflection"}
            </button>
            {!aiAvailable && !aiBusy && (
              <Link className="text-link" to="/about#on-device-ai">
                {ai.support.status === "unsupported"
                  ? "See device requirements"
                  : ai.phase === "error"
                    ? "Check On-device AI"
                    : "Set up AI"}
              </Link>
            )}
            {aiBusy && (
              <Link className="text-link" to="/about#on-device-ai">
                View progress
              </Link>
            )}
          </div>
        )}
        {aiBusy && (
          <p className="reading-panel__ai-state" aria-live="polite">
            {ai.progress?.text ??
              (ai.phase === "downloading"
                ? "Downloading the model in this browser…"
                : "Starting the model on this device…")}
          </p>
        )}
        <p className="reading-panel__caveat">
          A reflection describes what the sound reader found, not an ecological
          fact. It cannot explain why a sound was heard less often.
        </p>
      </footer>
    </section>
  );
}
