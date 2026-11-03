import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ON_DEVICE_MODEL } from "./config";
import { isModelCached, removeModelCache } from "./cache";
import {
  disposeEngine,
  generateText,
  isEngineLoaded,
  loadEngine,
  resetEngineChat,
  testEngine,
} from "./engine";
import type { OnDeviceMessage } from "./prompt";
import {
  clearDownloadFlag,
  markDownloadStarted,
  wasDownloadStarted,
} from "./storage";
import {
  detectOnDeviceSupport,
  type OnDeviceSupport,
} from "./support";

export type OnDevicePhase =
  | "checking"
  | "unsupported"
  | "not-downloaded"
  | "downloading"
  | "loading"
  | "testing"
  | "downloaded"
  | "ready"
  | "error";

export interface OnDeviceProgress {
  value: number;
  text: string;
}

export interface OnDeviceAIState {
  model: typeof ON_DEVICE_MODEL;
  support: OnDeviceSupport;
  phase: OnDevicePhase;
  cached: boolean;
  resume: boolean;
  progress: OnDeviceProgress | null;
  error: string | null;
  readyAt: string | null;
  canWrite: boolean;
  download: () => Promise<void>;
  cancel: () => void;
  remove: () => Promise<void>;
  prepare: () => Promise<boolean>;
  generate: (
    messages: OnDeviceMessage[],
    options?: { maxTokens?: number; temperature?: number },
  ) => Promise<string>;
  refresh: () => Promise<void>;
}

const DEFAULT_SUPPORT: OnDeviceSupport = {
  status: "unsupported",
  reason: "On-device AI is not available in this browser context.",
  adapterName: null,
};

const FALLBACK_STATE: OnDeviceAIState = {
  model: ON_DEVICE_MODEL,
  support: DEFAULT_SUPPORT,
  phase: "unsupported",
  cached: false,
  resume: false,
  progress: null,
  error: null,
  readyAt: null,
  canWrite: false,
  download: async () => undefined,
  cancel: () => undefined,
  remove: async () => undefined,
  prepare: async () => false,
  generate: async () => {
    throw new Error("On-device AI is not available here.");
  },
  refresh: async () => undefined,
};

const OnDeviceAIContext = createContext<OnDeviceAIState>(FALLBACK_STATE);

function describeError(error: unknown): string {
  let message = "";
  if (error instanceof Error && error.message.trim()) {
    message = error.message.trim();
  } else if (typeof error === "string") {
    message = error.trim();
  } else if (error && typeof error === "object") {
    const record = error as { message?: unknown; toString?: () => string };
    if (typeof record.message === "string" && record.message.trim()) {
      message = record.message.trim();
    } else if (typeof record.toString === "function") {
      const text = record.toString();
      if (text && text !== "[object Object]") {
        message = text.trim();
      }
    }
  }
  if (!message) {
    return "The on-device model could not start. Try again.";
  }
  if (/failed to fetch|networkerror|load failed|network request/i.test(message)) {
    return "The model files could not be downloaded. Check your connection and try again.";
  }
  return message.length > 420 ? `${message.slice(0, 417)}…` : message;
}

function progressValue(progress: number): number {
  return Number.isFinite(progress)
    ? Math.max(0, Math.min(1, progress))
    : 0;
}

export function OnDeviceAIProvider({ children }: { children: ReactNode }) {
  const [support, setSupport] = useState<OnDeviceSupport>({
    status: "checking",
    reason: null,
    adapterName: null,
  });
  const [phase, setPhase] = useState<OnDevicePhase>("checking");
  const [cached, setCached] = useState(false);
  const [resume, setResume] = useState(false);
  const [progress, setProgress] = useState<OnDeviceProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [readyAt, setReadyAt] = useState<string | null>(null);

  const supportRef = useRef<OnDeviceSupport>(support);
  const phaseRef = useRef<OnDevicePhase>(phase);
  const cachedRef = useRef(cached);
  const errorRef = useRef<string | null>(error);
  const readyAtRef = useRef<string | null>(readyAt);
  const refreshRef = useRef<Promise<void> | null>(null);
  const prepareRef = useRef<Promise<boolean> | null>(null);
  const runIdRef = useRef(0);

  const updatePhase = useCallback((next: OnDevicePhase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  const updateSupport = useCallback((next: OnDeviceSupport) => {
    supportRef.current = next;
    setSupport(next);
  }, []);

  const updateCached = useCallback((next: boolean) => {
    cachedRef.current = next;
    setCached(next);
  }, []);

  const updateError = useCallback((next: string | null) => {
    errorRef.current = next;
    setError(next);
  }, []);

  const updateReadyAt = useCallback((next: string | null) => {
    readyAtRef.current = next;
    setReadyAt(next);
  }, []);

  const refresh = useCallback(async (): Promise<void> => {
    if (
      phaseRef.current === "downloading" ||
      phaseRef.current === "loading" ||
      phaseRef.current === "testing"
    ) {
      return;
    }
    if (refreshRef.current) {
      return refreshRef.current;
    }

    const task = (async () => {
      updateError(null);
      updatePhase("checking");
      const nextSupport = await detectOnDeviceSupport();
      updateSupport(nextSupport);
      if (nextSupport.status !== "supported") {
        updateCached(false);
        setResume(false);
        updatePhase("unsupported");
        return;
      }

      const has = await isModelCached();
      const loaded = isEngineLoaded();
      updateCached(has || loaded);
      setResume(!has && !loaded && wasDownloadStarted());

      if (has || loaded) {
        if (loaded && readyAtRef.current) {
          updatePhase("ready");
        } else {
          updatePhase("downloaded");
        }
      } else {
        updateReadyAt(null);
        updatePhase("not-downloaded");
      }
    })();

    refreshRef.current = task;
    try {
      await task;
    } finally {
      refreshRef.current = null;
    }
  }, [
    updateCached,
    updateError,
    updatePhase,
    updateReadyAt,
    updateSupport,
  ]);

  const download = useCallback(async (): Promise<void> => {
    if (
      phaseRef.current === "downloading" ||
      phaseRef.current === "loading" ||
      phaseRef.current === "testing"
    ) {
      return;
    }
    if (supportRef.current.status !== "supported") {
      updatePhase("unsupported");
      return;
    }

    const runId = ++runIdRef.current;
    updateError(null);
    updateReadyAt(null);
    setProgress({ value: 0, text: "Preparing the model download…" });
    updatePhase("downloading");
    markDownloadStarted();

    try {
      await navigator.storage?.persist?.();
    } catch {
      // Persistent storage is best effort.
    }

    try {
      const target = await loadEngine((report) => {
        if (runId !== runIdRef.current) {
          return;
        }
        setProgress({
          value: progressValue(report.progress),
          text: report.text || "Downloading the model…",
        });
      });
      if (runId !== runIdRef.current) {
        return;
      }

      updatePhase("testing");
      setProgress({ value: 1, text: "Testing the model on this device…" });
      await testEngine(target);
      if (runId !== runIdRef.current) {
        return;
      }

      const has = await isModelCached();
      updateCached(has);
      setResume(false);
      clearDownloadFlag();
      setProgress(null);
      updateReadyAt(new Date().toISOString());
      updatePhase("ready");
    } catch (downloadError) {
      if (runId !== runIdRef.current) {
        return;
      }
      disposeEngine();
      const has = await isModelCached().catch(() => false);
      updateCached(has);
      setResume(!has && wasDownloadStarted());
      setProgress(null);
      updateError(describeError(downloadError));
      updatePhase("error");
    }
  }, [
    updateCached,
    updateError,
    updatePhase,
    updateReadyAt,
  ]);

  const prepare = useCallback(async (): Promise<boolean> => {
    if (phaseRef.current === "ready") {
      return true;
    }
    if (phaseRef.current === "downloading") {
      return false;
    }
    if (prepareRef.current) {
      return prepareRef.current;
    }

    const runId = runIdRef.current;
    const task = (async () => {
      if (supportRef.current.status !== "supported") {
        return false;
      }
      const has = await isModelCached();
      updateCached(has);
      if (!has) {
        setResume(wasDownloadStarted());
        updatePhase("not-downloaded");
        return false;
      }

      updateError(null);
      setProgress({ value: 0, text: "Loading the model into memory…" });
      updatePhase("loading");
      try {
        const target = await loadEngine((report) => {
          if (runId !== runIdRef.current) {
            return;
          }
          setProgress({
            value: progressValue(report.progress),
            text: report.text || "Loading the model…",
          });
        });
        if (runId !== runIdRef.current) {
          return false;
        }

        updatePhase("testing");
        setProgress({ value: 1, text: "Testing the model on this device…" });
        await testEngine(target);
        if (runId !== runIdRef.current) {
          return false;
        }

        setProgress(null);
        updateReadyAt(new Date().toISOString());
        updatePhase("ready");
        return true;
      } catch (prepareError) {
        if (runId !== runIdRef.current) {
          return false;
        }
        disposeEngine();
        setProgress(null);
        updateError(describeError(prepareError));
        updatePhase("error");
        return false;
      }
    })();

    prepareRef.current = task;
    try {
      return await task;
    } finally {
      prepareRef.current = null;
    }
  }, [updateCached, updateError, updatePhase, updateReadyAt]);

  const cancel = useCallback((): void => {
    if (
      phaseRef.current !== "downloading" &&
      phaseRef.current !== "loading" &&
      phaseRef.current !== "testing"
    ) {
      return;
    }
    runIdRef.current += 1;
    disposeEngine();
    setProgress(null);
    setResume(true);
    updateError(
      "The model download was stopped. Cached parts will be reused when you resume.",
    );
    updatePhase("not-downloaded");
    void isModelCached().then((has) => {
      updateCached(has);
      if (has) {
        setResume(false);
        updateError(null);
        updatePhase("downloaded");
      }
    });
  }, [updateCached, updateError, updatePhase]);

  const remove = useCallback(async (): Promise<void> => {
    runIdRef.current += 1;
    disposeEngine();
    updateError(null);
    setProgress(null);
    setResume(false);
    updateReadyAt(null);
    updateCached(false);
    updatePhase("checking");
    clearDownloadFlag();
    try {
      await removeModelCache();
      updatePhase(
        supportRef.current.status === "supported"
          ? "not-downloaded"
          : "unsupported",
      );
    } catch (removeError) {
      updateError(describeError(removeError));
      updatePhase("error");
    }
  }, [
    updateCached,
    updateError,
    updatePhase,
    updateReadyAt,
  ]);

  const generate = useCallback(
    async (
      messages: OnDeviceMessage[],
      options?: { maxTokens?: number; temperature?: number },
    ): Promise<string> => {
      const ready = await prepare();
      if (!ready) {
        throw new Error(
          errorRef.current ??
            "On-device AI is not ready. Set it up in About first.",
        );
      }
      const target = await loadEngine();
      try {
        return await generateText(target, messages, options);
      } finally {
        await resetEngineChat();
      }
    },
    [prepare],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo<OnDeviceAIState>(
    () => ({
      model: ON_DEVICE_MODEL,
      support,
      phase,
      cached,
      resume,
      progress,
      error,
      readyAt,
      canWrite: phase === "ready" || phase === "downloaded",
      download,
      cancel,
      remove,
      prepare,
      generate,
      refresh,
    }),
    [
      support,
      phase,
      cached,
      resume,
      progress,
      error,
      readyAt,
      download,
      cancel,
      remove,
      prepare,
      generate,
      refresh,
    ],
  );

  return (
    <OnDeviceAIContext.Provider value={value}>
      {children}
    </OnDeviceAIContext.Provider>
  );
}

export function useOnDeviceAI(): OnDeviceAIState {
  return useContext(OnDeviceAIContext);
}
