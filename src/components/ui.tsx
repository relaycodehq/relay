import {
  useEffect,
  useMemo,
  useRef,
  useId,
  type ReactNode,
  Component,
  type ErrorInfo,
} from "react";
import { X, AlertCircle, LoaderCircle, FileCode2, Folder } from "lucide-react";
import Markdown from "react-markdown";
import { createIncrementalMarkdownPlugin } from "../vendor/t3code/markdown-incremental";
import { api } from "../lib/api";
import {
  projectFileLink,
  type ProjectFileLink,
} from "../lib/project-file-links";
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
      type="button"
      className={`icon-button ${active ? "active" : ""}`}
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
export function Loading({ text = "Loading…" }: { text?: string }) {
  return (
    <div className="empty small" role="status">
      <LoaderCircle size={20} className="spin" />
      {text}
    </div>
  );
}
function markdownNodeText(node: unknown): string {
  if (!node || typeof node !== "object") return "";
  const value = node as { value?: unknown; children?: unknown[] };
  if (typeof value.value === "string") return value.value;
  return Array.isArray(value.children)
    ? value.children.map(markdownNodeText).join("")
    : "";
}
export function RichText({
  text,
  projectRoot,
  onOpenFile,
}: {
  text: string;
  projectRoot?: string;
  onOpenFile?: (target: ProjectFileLink) => void;
}) {
  const remarkPlugins = useMemo(() => [createIncrementalMarkdownPlugin()], []);
  return (
    <div className="markdown">
      <Markdown
        remarkPlugins={remarkPlugins}
        components={{
          pre: ({ node }) => (
            <pre>
              <code>{markdownNodeText(node)}</code>
            </pre>
          ),
          a: ({ href, children }) => {
            const target =
              projectRoot && href ? projectFileLink(href, projectRoot) : null;
            return target && onOpenFile ? (
              <button
                type="button"
                className="chat-file-link"
                title={`${target.path}${target.line ? `:${target.line}` : ""}`}
                onClick={() => onOpenFile?.(target)}
              >
                {target.directory ? (
                  <Folder size={12} />
                ) : (
                  <FileCode2 size={12} />
                )}
                {children}
              </button>
            ) : href && /^(https?:|mailto:)/i.test(href) ? (
              <a
                href={href}
                onClick={(e) => {
                  e.preventDefault();
                  if (href) void api.openExternal(href).catch(() => {});
                }}
              >
                {children}
              </a>
            ) : (
              <span>{children}</span>
            );
          },
          code: ({ children, className }) => {
            const value = String(children).trim();
            const target =
              !className && projectRoot && onOpenFile && !value.includes("\n")
                ? projectFileLink(value, projectRoot, true)
                : null;
            return target ? (
              <button
                type="button"
                className="chat-file-link"
                title={`${target.path}${target.line ? `:${target.line}` : ""}`}
                onClick={() => onOpenFile?.(target)}
              >
                {target.directory ? (
                  <Folder size={12} />
                ) : (
                  <FileCode2 size={12} />
                )}
                <span>{children}</span>
              </button>
            ) : (
              <code className={className}>{children}</code>
            );
          },
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
        <button onClick={() => location.reload()}>Reload Relay</button>
      </div>
    ) : (
      this.props.children
    );
  }
}
