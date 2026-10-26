import {
  useEffect,
  useRef,
  useId,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  Component,
  type ErrorInfo,
} from "react";
import { createPortal } from "react-dom";
import { X, AlertCircle } from "lucide-react";
import { useReturnFocus } from "../lib/focus-return";
import { useBackdropClose } from "../lib/backdrop-close";
import { errorMessage } from "../../shared/error-message";

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
  onClick?: (event: ReactMouseEvent<HTMLButtonElement>) => void;
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
  actions,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  /** Beside the close button in the heading. */
  actions?: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const headingId = useId();
  useReturnFocus();
  // The panel is the dialog itself, so its ::backdrop is a press on the
  // dialog outside its box.
  const backdropClose = useBackdropClose(onClose, (e) => {
    if (e.target !== e.currentTarget) return false;
    const r = e.currentTarget.getBoundingClientRect();
    return (
      e.clientX < r.left ||
      e.clientX > r.right ||
      e.clientY < r.top ||
      e.clientY > r.bottom
    );
  });
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  // On the body, so a scoped reset like the sidebar's `.sb button` can't
  // restyle a dialog opened from inside it.
  return createPortal(
    <dialog
      ref={ref}
      aria-labelledby={headingId}
      className={`modal ${className}`}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      {...backdropClose}
    >
      <div className="modal-heading">
        <h2 id={headingId}>{title}</h2>
        {actions}
        <IconButton label="Close dialog" onClick={onClose}>
          <X size={18} />
        </IconButton>
      </div>
      {children}
    </dialog>,
    document.body,
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
        {errorMessage(error)}
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
