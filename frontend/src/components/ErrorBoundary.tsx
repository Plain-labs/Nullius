import { Component, ErrorInfo, ReactNode } from "react";

interface Props {
  children: ReactNode;
  /** Optional custom fallback UI */
  fallback?: (error: Error, reset: () => void) => ReactNode;
}

interface State {
  error: Error | null;
}

// ---------------------------------------------------------------------------
// Lightweight structured error reporter.
// Sends a JSON payload to the configured endpoint when VITE_ERROR_ENDPOINT is
// set. Falls back to console.error only (safe for local dev / hackathon use).
// ---------------------------------------------------------------------------
function reportError(error: Error, componentStack: string | null | undefined): void {
  const endpoint =
    typeof import.meta !== "undefined"
      ? (import.meta.env as Record<string, string | undefined>)["VITE_ERROR_ENDPOINT"]
      : undefined;

  // Always log to console so errors are visible in DevTools
  console.error("[Nullius] Unhandled render error:", error.message, componentStack);

  if (!endpoint) return;

  // Best-effort fire-and-forget — do not await or throw
  try {
    const body = JSON.stringify({
      message:   error.message,
      stack:     error.stack,
      component: componentStack,
      url:       window.location.href,
      ts:        new Date().toISOString(),
    });
    navigator.sendBeacon(endpoint, new Blob([body], { type: "application/json" }));
  } catch {
    // Swallow — reporting must never crash the app
  }
}

/**
 * Catches unhandled render errors in child components and shows a
 * friendly recovery UI instead of a blank screen.
 *
 * Set VITE_ERROR_ENDPOINT in .env to enable remote error reporting via
 * navigator.sendBeacon (e.g. a Sentry ingest URL or a custom endpoint).
 */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    reportError(error, info.componentStack);
  }

  reset = () => {
    this.setState({ error: null });
  };

  render() {
    const { error } = this.state;
    const { children, fallback } = this.props;

    if (error) {
      if (fallback) return fallback(error, this.reset);

      return (
        <div className="card" style={{ textAlign: "center", padding: "48px 32px" }}>
          <div style={{ fontSize: 40, marginBottom: 16 }}>⚠️</div>
          <h2 style={{ marginBottom: 8 }}>Something went wrong</h2>
          <p className="subtitle" style={{ marginBottom: 24 }}>
            An unexpected error occurred. Your wallet and funds are not affected.
          </p>
          <code
            style={{
              display: "block",
              background: "var(--bg3)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              padding: "12px 16px",
              fontSize: 13,
              color: "var(--error)",
              marginBottom: 24,
              textAlign: "left",
              overflowWrap: "break-word",
            }}
          >
            {error.message}
          </code>
          <button className="btn-primary" onClick={this.reset}>
            Try again
          </button>
        </div>
      );
    }

    return children;
  }
}
