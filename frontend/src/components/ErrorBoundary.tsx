import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("Hush Atlas UI error", error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <main className="error-boundary">
          <span className="eyebrow">Something went wrong</span>
          <h1>This page went quiet.</h1>
          <p>
            Your recordings are safe. Reload the page to continue.
          </p>
          <button
            type="button"
            className="button button--primary"
            onClick={() => window.location.reload()}
          >
            Reload the page
          </button>
        </main>
      );
    }
    return this.props.children;
  }
}
