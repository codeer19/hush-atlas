import type { ReactNode } from "react";
import { AlertTriangle, Loader2, RefreshCw } from "lucide-react";
import { cx } from "../utils";

export function Spinner({ size = 18 }: { size?: number }) {
  return (
    <Loader2
      className="spin"
      size={size}
      aria-hidden="true"
      focusable="false"
    />
  );
}

export function LoadingPanel({
  label = "Opening your atlas",
  compact = false,
}: {
  label?: string;
  compact?: boolean;
}) {
  return (
    <div
      className={cx("loading-panel", compact && "loading-panel--compact")}
      role="status"
      aria-live="polite"
    >
      <span className="loading-panel__line" aria-hidden="true" />
      <Spinner />
      <p>{label}</p>
    </div>
  );
}

export function ErrorPanel({
  message,
  onRetry,
  title = "Something could not be opened",
}: {
  message: string;
  onRetry?: () => void;
  title?: string;
}) {
  return (
    <div className="error-panel" role="alert">
      <AlertTriangle size={22} aria-hidden="true" />
      <div>
        <h2>{title}</h2>
        <p>{message}</p>
        {onRetry && (
          <button
            type="button"
            className="button button--ghost button--small"
            onClick={onRetry}
          >
            <RefreshCw size={14} aria-hidden="true" />
            Try again
          </button>
        )}
      </div>
    </div>
  );
}

export function EmptyState({
  eyebrow,
  title,
  body,
  action,
  icon,
  className,
}: {
  eyebrow?: string;
  title: string;
  body: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("empty-state", className)}>
      {icon && <div className="empty-state__icon">{icon}</div>}
      {eyebrow && <p className="eyebrow">{eyebrow}</p>}
      <h2>{title}</h2>
      <div className="empty-state__body">{body}</div>
      {action && <div className="empty-state__action">{action}</div>}
    </div>
  );
}

export function SkeletonLine({ width = "100%" }: { width?: string }) {
  return <span className="skeleton-line" style={{ width }} aria-hidden="true" />;
}
