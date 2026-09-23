import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useId,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  Component,
  Fragment,
  type ErrorInfo,
} from "react";
import {
  X,
  AlertCircle,
  LoaderCircle,
  FileCode2,
  Folder,
  Copy,
  Check,
} from "lucide-react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
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
const MIN_TABLE_COLUMN_WIDTH = 60;
// Columns size themselves until the first drag; after that the table switches to
// fixed layout with the measured widths so each column can be dragged freely.
function MarkdownTable({ children }: { children?: ReactNode }) {
  const tableRef = useRef<HTMLTableElement>(null);
  const [widths, setWidths] = useState<number[] | null>(null);
  const startResize = (event: ReactPointerEvent<HTMLTableElement>) => {
    const handle = (event.target as HTMLElement).closest(
      ".markdown-table-resizer",
    );
    const cell = handle?.parentElement as HTMLTableCellElement | null;
    const headerRow = tableRef.current?.rows[0];
    if (!handle || !cell || !headerRow || event.button !== 0) return;
    event.preventDefault();
    const index = cell.cellIndex;
    const initial = Array.from(headerRow.cells, (headerCell) =>
      Math.round(headerCell.getBoundingClientRect().width),
    );
    const startX = event.clientX;
    setWidths(initial);
    const move = (moveEvent: PointerEvent) => {
      const next = [...initial];
      next[index] = Math.max(
        MIN_TABLE_COLUMN_WIDTH,
        initial[index] + moveEvent.clientX - startX,
      );
      setWidths(next);
    };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
      document.body.classList.remove("resizing-table-column");
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
    document.body.classList.add("resizing-table-column");
  };
  return (
    <div className={`markdown-table${widths ? " resized" : ""}`}>
      <table
        ref={tableRef}
        className={widths ? "resized" : undefined}
        style={
          widths
            ? { width: widths.reduce((sum, width) => sum + width, 0) }
            : undefined
        }
        onPointerDown={startResize}
        onDoubleClick={(event) => {
          if (
            (event.target as HTMLElement).closest(".markdown-table-resizer")
          )
            setWidths(null);
        }}
      >
        {widths && (
          <colgroup>
            {widths.map((width, index) => (
              <col key={index} style={{ width }} />
            ))}
          </colgroup>
        )}
        {children}
      </table>
    </div>
  );
}
// Quotes carry a copy button so the quoted text can be lifted without the reply around it.
function MarkdownQuote({ children }: { children?: ReactNode }) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(timer);
  }, [copied]);
  return (
    <blockquote className="markdown-quote">
      <div ref={contentRef}>{children}</div>
      <button
        type="button"
        className="markdown-quote-copy"
        title={copied ? "Copied" : "Copy quote"}
        aria-label={copied ? "Copied" : "Copy quote"}
        onClick={() => {
          const text = contentRef.current?.innerText.trim();
          if (text)
            void api
              .writeClipboard(text)
              .then(() => setCopied(true))
              .catch(() => {});
        }}
      >
        {copied ? <Check size={13} /> : <Copy size={13} />}
      </button>
    </blockquote>
  );
}
/**
 * Splits Markdown into top-level blocks at blank lines no construct spans:
 * outside fenced code, and before an unindented line that doesn't continue a
 * list. A streaming answer then re-parses only its last block.
 */
export function markdownBlocks(text: string): string[] {
  // Definitions, footnotes and HTML comments reach across blank lines.
  if (/^ {0,3}\[[^\]]+\]:|<!--/m.test(text)) return [text];
  const lines = text.split("\n"),
    blocks: string[] = [];
  let start = 0,
    content = false,
    blank = false,
    fence: RegExp | undefined;
  lines.forEach((line, i) => {
    if (fence) {
      if (fence.test(line)) fence = undefined;
      return;
    }
    if (!line.trim()) {
      blank = content;
      return;
    }
    if (blank && /^\S/.test(line) && !/^([*+-]|\d{1,9}[.)])(\s|$)/.test(line)) {
      blocks.push(lines.slice(start, i).join("\n"));
      start = i;
    }
    blank = false;
    content = true;
    const open = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (open) fence = new RegExp(`^ {0,3}${open[0]}{${open.length},}[ \\t]*$`);
  });
  blocks.push(lines.slice(start).join("\n"));
  return blocks;
}
const MarkdownBlock = memo(function MarkdownBlock({
  text,
  components,
}: {
  text: string;
  components: Components;
}) {
  // GFM parses tables, task lists, strikethrough and bare links before the incremental pass.
  const remarkPlugins = useMemo(
    () => [remarkGfm, createIncrementalMarkdownPlugin()],
    [],
  );
  return (
    <Markdown remarkPlugins={remarkPlugins} components={components}>
      {text}
    </Markdown>
  );
});
export const RichText = memo(function RichText({
  text,
  projectRoot,
  onOpenFile,
}: {
  text: string;
  projectRoot?: string;
  onOpenFile?: (target: ProjectFileLink) => void;
}) {
  // Components must keep their identity across renders, or React remounts
  // every code span, table and quote whenever the text changes.
  const openFile = useRef(onOpenFile);
  openFile.current = onOpenFile;
  const linksFiles = !!onOpenFile;
  const components = useMemo<Components>(
    () => ({
      table: ({ children }) => <MarkdownTable>{children}</MarkdownTable>,
      blockquote: ({ children }) => <MarkdownQuote>{children}</MarkdownQuote>,
      th: ({ children, style }) => (
        <th style={style}>
          {children}
          <span
            className="markdown-table-resizer"
            aria-hidden
            title="Drag to resize, double-click to reset"
          />
        </th>
      ),
      pre: ({ node }) => (
        <pre>
          <code>{markdownNodeText(node)}</code>
        </pre>
      ),
      a: ({ href, children }) => {
        const target =
          projectRoot && linksFiles && href
            ? projectFileLink(href, projectRoot)
            : null;
        return target ? (
          <button
            type="button"
            className="chat-file-link"
            title={`${target.path}${target.line ? `:${target.line}` : ""}`}
            onClick={() => openFile.current?.(target)}
          >
            {target.directory ? <Folder size={12} /> : <FileCode2 size={12} />}
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
          !className && projectRoot && linksFiles && !value.includes("\n")
            ? projectFileLink(value, projectRoot, true)
            : null;
        return target ? (
          <button
            type="button"
            className="chat-file-link"
            title={`${target.path}${target.line ? `:${target.line}` : ""}`}
            onClick={() => openFile.current?.(target)}
          >
            {target.directory ? <Folder size={12} /> : <FileCode2 size={12} />}
            <span>{children}</span>
          </button>
        ) : (
          <code className={className}>{children}</code>
        );
      },
      img: ({ alt }) => <span className="muted">[Image: {alt}]</span>,
    }),
    [projectRoot, linksFiles],
  );
  const blocks = useMemo(() => markdownBlocks(text), [text]);
  return (
    <div className="markdown">
      {blocks.map((block, index) => (
        <Fragment key={index}>
          {index > 0 && "\n"}
          <MarkdownBlock text={block} components={components} />
        </Fragment>
      ))}
    </div>
  );
});
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
