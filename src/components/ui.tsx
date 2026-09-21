import {
  useEffect,
  useRef,
  useId,
  type ReactNode,
  Component,
  type ErrorInfo,
} from "react";
import { X, AlertCircle, LoaderCircle } from "lucide-react";
import Markdown from "react-markdown";
import { api } from "../lib/api";
export function IconButton({
  label,
  children,
  onClick,
  active,
  disabled,
}: {
  label: string;
  children: ReactNode;
  onClick?: () => void;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      className={`icon-button ${active ? "active" : ""}`}
      title={label}
      aria-label={label}
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
export function Loading({ text = "Loading…" }: { text?: string }) {
  return (
    <div className="empty small" role="status">
      <LoaderCircle size={20} className="spin" />
      {text}
    </div>
  );
}
export function RichText({ text }: { text: string }) {
  return (
    <div className="markdown">
      <Markdown
        components={{
          a: ({ href, children }) => (
            <a
              href={href}
              onClick={(e) => {
                e.preventDefault();
                if (href) void api.openExternal(href).catch(() => {});
              }}
            >
              {children}
            </a>
          ),
          img: ({ alt }) => <span className="muted">[Image: {alt}]</span>,
        }}
      >
        {text}
      </Markdown>
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
export function relativeDate(value: string) {
  const minutes = Math.max(
    0,
    Math.round((Date.now() - new Date(value).getTime()) / 60000),
  );
  return minutes < 60
    ? `${minutes}m`
    : minutes < 1440
      ? `${Math.floor(minutes / 60)}h`
      : minutes < 10080
        ? `${Math.floor(minutes / 1440)}d`
        : new Date(value).toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
          });
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
        <button onClick={() => location.reload()}>Reload Review Relay</button>
      </div>
    ) : (
      this.props.children
    );
  }
}
