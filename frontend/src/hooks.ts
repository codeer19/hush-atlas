import { useEffect, useRef, useState } from "react";
import { getErrorMessage } from "./utils";

export interface Resource<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

/**
 * A small data loader keyed by a stable string. The loader itself may close over
 * changing values; only the key controls when a new request is made.
 */
export function useResource<T>(
  key: string,
  load: () => Promise<T>,
): Resource<T> {
  const loader = useRef(load);
  const activeKey = useRef(key);
  const [version, setVersion] = useState(0);
  const [state, setState] = useState<{
    data: T | null;
    loading: boolean;
    error: string | null;
  }>({ data: null, loading: true, error: null });

  useEffect(() => {
    loader.current = load;
  });

  useEffect(() => {
    let active = true;
    const keyChanged = activeKey.current !== key;
    activeKey.current = key;
    setState((previous) => ({
      data: keyChanged ? null : previous.data,
      loading: keyChanged || previous.data === null,
      error: null,
    }));
    loader
      .current()
      .then((data) => {
        if (active) {
          setState({ data, loading: false, error: null });
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setState((previous) => ({
            data: previous.data,
            loading: false,
            error: getErrorMessage(error),
          }));
        }
      });
    return () => {
      active = false;
    };
  }, [key, version]);

  return {
    ...state,
    refresh: () => setVersion((current) => current + 1),
  };
}

export function useDocumentTitle(title?: string): void {
  useEffect(() => {
    document.title = title ? `${title} · Hush Atlas` : "Hush Atlas";
  }, [title]);
}

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window === "undefined" ? false : window.matchMedia(query).matches,
  );

  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [query]);

  return matches;
}

export function usePolling(callback: () => void, intervalMs: number | null): void {
  const callbackRef = useRef(callback);
  useEffect(() => {
    callbackRef.current = callback;
  });
  useEffect(() => {
    if (intervalMs === null) {
      return;
    }
    const timer = window.setInterval(() => {
      if (!document.hidden) {
        callbackRef.current();
      }
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
}

export function useCopyToClipboard(): {
  copied: boolean;
  copy: (text: string) => Promise<boolean>;
} {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current !== null) {
        window.clearTimeout(timer.current);
      }
    };
  }, []);

  const copy = async (text: string): Promise<boolean> => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      if (timer.current !== null) {
        window.clearTimeout(timer.current);
      }
      timer.current = window.setTimeout(() => setCopied(false), 2400);
      return true;
    } catch {
      return false;
    }
  };

  return { copied, copy };
}
