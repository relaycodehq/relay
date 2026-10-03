import {
  useEffect,
  useRef,
  useId,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  Component,
  type ErrorInfo,
} from "react";
import { X, AlertCircle } from "lucide-react";
/**
 * Enter or Space opens a card or shelf row. Keys pressed on its own buttons,
 * or in a menu they open, bubble up here and are left to them.
 */
export const rowKeys = (open: () => void) => (e: ReactKeyboardEvent) => {
  if (e.target !== e.currentTarget || (e.key !== "Enter" && e.key !== " "))
    return;
  e.preventDefault();
  open();
};
export function IconButton({
  label,
  children,
  onClick,
  active,
  disabled,
  className = "",
}: {
  label: string;
  children: ReactNode;
  onClick?: () => void;
  active?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={`icon-button ${className} ${active ? "active" : ""}`}
      title={label}
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}
export function Modal({
  title,
  onClose,
  children,
  className = "",
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const headingId = useId();
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby={headingId}
      className={`modal ${className}`}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          const r = e.currentTarget.getBoundingClientRect();
          if (
            e.clientX < r.left ||
            e.clientX > r.right ||
            e.clientY < r.top ||
            e.clientY > r.bottom
          )
            onClose();
        }
      }}
    >
      <div className="modal-heading">
        <h2 id={headingId}>{title}</h2>
        <IconButton label="Close dialog" onClick={onClose}>
          <X size={18} />
        </IconButton>
      </div>
      {children}
    </dialog>
  );
}
export function ErrorBox({
  error,
  retry,
}: {
  error: unknown;
  retry?: () => void;
}) {
  return (
    <div className="error-box" role="alert">
      <AlertCircle size={17} />
      <div>
        {error instanceof Error ? error.message : String(error)}
        {retry && <button onClick={retry}>Try again</button>}
      </div>
    </div>
  );
}
// The one spinner: an arc that breathes as it turns, over a faint track.
export function Spinner({
  size = 14,
  steady,
}: {
  size?: number;
  /** The arc keeps its length and only turns; for spinners that run for long or in numbers. */
  steady?: boolean;
}) {
  // The span turns rather than the svg: Chrome can't composite an animated
  // transform on SVG, so turning the svg costs the main thread every frame.
  return (
    <span className={steady ? "spinner steady" : "spinner"} aria-hidden="true">
      <svg width={size} height={size} viewBox="0 0 16 16">
        <circle className="spinner-track" cx="8" cy="8" r="6.25" />
        <circle
          className="spinner-arc"
          cx="8"
          cy="8"
          r="6.25"
          pathLength={100}
        />
      </svg>
    </span>
  );
}
export function Loading({ text = "Loading…" }: { text?: string }) {
  return (
    <div className="empty small" role="status">
      <Spinner size={18} />
      {text}
    </div>
  );
}
export function Avatar({ name }: { name: string }) {
  return (
    <span className="avatar" aria-label={name}>
      {name.slice(0, 2).toUpperCase()}
    </span>
  );
}
export class ErrorBoundary extends Component<
  { children: ReactNode },
  { error?: Error }
> {
  state: { error?: Error } = {};
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack);
  }
  render() {
    return this.state.error ? (
      <div className="empty">
        <h2>Something went wrong</h2>
        <p>{this.state.error.message}</p>
        <button onClick={() => location.reload()}>Reload Relay</button>
      </div>
    ) : (
      this.props.children
    );
  }
}
