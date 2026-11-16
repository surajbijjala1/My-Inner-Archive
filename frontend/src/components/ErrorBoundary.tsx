import { Component, type ErrorInfo, type ReactNode } from "react";
import { logCrash } from "../errorLog";

interface ErrorBoundaryProps {
  /** Names the area in the console log ("journal", "chat"…). Never shown. */
  area: string;
  /** What to show instead. `retry` clears the error and renders the children again. */
  fallback: (retry: () => void) => ReactNode;
  children: ReactNode;
}

interface ErrorBoundaryState {
  failed: boolean;
}

/**
 * Catches a render error in its children so one broken area can't blank the
 * whole page. (React only offers this as a class component.) Give it a `key`
 * that changes when the user moves somewhere else, so leaving a broken area
 * also leaves its error behind.
 */
export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    logCrash(this.props.area, error, info.componentStack);
  }

  retry = (): void => {
    this.setState({ failed: false });
  };

  render(): ReactNode {
    return this.state.failed ? this.props.fallback(this.retry) : this.props.children;
  }
}

export interface CrashAction {
  label: string;
  onClick: () => void;
  primary?: boolean;
  /** Only makes sense on a narrow page (e.g. leaving a full-screen chat). */
  phoneOnly?: boolean;
}

interface CrashFallbackProps {
  /** "page" fills the screen; "area" sits inside a panel; "sheet" is a dialog. */
  variant: "page" | "area" | "sheet";
  title: string;
  /** Prose explanation — what broke, and what is and isn't safe. */
  children: ReactNode;
  actions: CrashAction[];
}

/**
 * What a broken area shows instead of itself: a short handwritten heading,
 * the explanation in prose, and handwritten actions. Uses only the sheet
 * styles the rest of the app already has.
 */
export function CrashFallback({ variant, title, children, actions }: CrashFallbackProps) {
  const body = (
    <div className={`crash crash--${variant}`} role="alert">
      <div className="crash-title">{title}</div>
      <p className="sheet-text">{children}</p>
      <div className="sheet-actions crash-actions">
        {actions.map((a) => (
          <button
            key={a.label}
            className={`sheet-btn${a.primary ? " sheet-btn--primary" : ""}${a.phoneOnly ? " mobile-only-inline" : ""}`}
            onClick={a.onClick}
          >
            {a.label}
          </button>
        ))}
      </div>
    </div>
  );

  if (variant === "page") return <div className="center-screen crash-screen">{body}</div>;
  if (variant === "sheet") {
    return (
      <div className="modal-overlay">
        <div className="modal-content" style={{ maxWidth: 360 }}>{body}</div>
      </div>
    );
  }
  return body;
}
