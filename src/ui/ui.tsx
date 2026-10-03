import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useId,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  Component,
  Fragment,
  createContext,
  useContext,
  useInsertionEffect,
  type CSSProperties,
  type ErrorInfo,
} from "react";
import { X, AlertCircle, Folder, Copy, Check } from "lucide-react";
import Markdown, {
  defaultUrlTransform,
  type Components,
  type UrlTransform,
} from "react-markdown";
import remarkGfm from "remark-gfm";
import { createIncrementalMarkdownPlugin } from "../vendor/t3code/markdown-incremental";
import { api } from "../lib/api";
import { looksLikeColor } from "../lib/color-value";
import { useCopy } from "../lib/useCopy";
import { CodeBlock } from "./CodeBlock";
import { ColorCode } from "./ColorCode";
import {
  projectFileLink,
  type ProjectFileLink,
} from "../../shared/project-file-links";
import {
  ensureFileIconSprite,
  fileIcon,
  parentSuffixes,
} from "../lib/file-icons";
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
function markdownNodeText(node: unknown): string {
  if (!node || typeof node !== "object") return "";
  const value = node as { value?: unknown; children?: unknown[] };
  if (typeof value.value === "string") return value.value;
  return Array.isArray(value.children)
    ? value.children.map(markdownNodeText).join("")
    : "";
}
/** The fence language of a `pre` node, from its `language-*` code class. */
function markdownCodeLanguage(node: unknown): string | undefined {
  const code = (node as { children?: unknown[] } | undefined)?.children?.[0] as
    { properties?: { className?: unknown } } | undefined;
  const classes = code?.properties?.className;
  const match = (Array.isArray(classes) ? classes : [])
    .map(String)
    .find((name) => name.startsWith("language-"));
  return match?.slice("language-".length).toLowerCase() || undefined;
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
          if ((event.target as HTMLElement).closest(".markdown-table-resizer"))
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
  const [copied, copy] = useCopy();
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
          if (text) copy(text);
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
/** Parent folders for file names the message links under several paths. */
const FileLinkSuffixes = createContext<ReadonlyMap<string, string>>(new Map());

/** Every in-project file a message links or names in inline code. */
function linkedProjectFiles(text: string, root: string): string[] {
  const paths = new Set<string>();
  // Fenced code never becomes a chip; the odd segments are the fences.
  text.split(/(```[\s\S]*?(?:```|$))/).forEach((segment, index) => {
    if (index % 2) return;
    for (const [, href] of segment.matchAll(/\]\(<?([^)\s>]+)/g))
      if (href) {
        const target = projectFileLink(href, root);
        if (target) paths.add(target.path);
      }
    for (const [, code] of segment.matchAll(/`([^`\n]+)`/g))
      if (code) {
        const target = projectFileLink(code.trim(), root, true);
        if (target) paths.add(target.path);
      }
  });
  return [...paths];
}

export function FileEntryIcon({
  path,
  directory,
}: {
  path: string;
  directory: boolean;
}) {
  useInsertionEffect(ensureFileIconSprite, []);
  if (directory) return <Folder className="file-entry-icon" aria-hidden />;
  const icon = fileIcon(path);
  return (
    <svg
      aria-hidden
      className="file-entry-icon"
      viewBox="0 0 16 16"
      style={
        {
          "--file-icon-light": icon.colors[0],
          "--file-icon-dark": icon.colors[1],
        } as CSSProperties
      }
    >
      <use href={`#${icon.name}`} />
    </svg>
  );
}

/** T3-style file chip: type icon, file name, and a line when there is one. */
function FileLinkChip({
  target,
  onOpen,
}: {
  target: ProjectFileLink;
  onOpen: (target: ProjectFileLink) => void;
}) {
  const suffix = useContext(FileLinkSuffixes).get(target.path);
  const label = [
    target.path.split("/").at(-1) || target.path,
    ...(suffix ? [suffix] : []),
    ...(target.line ? [`L${target.line}`] : []),
  ].join(" · ");
  return (
    <button
      type="button"
      className="chat-file-link"
      title={`${target.path}${target.line ? `:${target.line}` : ""}`}
      onClick={() => onOpen(target)}
    >
      <FileEntryIcon path={target.path} directory={target.directory} />
      <span className="chat-file-link-label">{label}</span>
    </button>
  );
}
// The default drops data: and file: URLs; an image may use either, a link may not.
const urlTransform: UrlTransform = (url, key, node) =>
  key === "src" &&
  node.tagName === "img" &&
  /^(?:data:image\/|file:)/i.test(url)
    ? url
    : defaultUrlTransform(url);
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
    <Markdown
      remarkPlugins={remarkPlugins}
      components={components}
      urlTransform={urlTransform}
    >
      {text}
    </Markdown>
  );
});
export const RichText = memo(function RichText({
  text,
  projectRoot,
  onOpenFile,
  inlineCode,
  image,
}: {
  text: string;
  projectRoot?: string;
  onOpenFile?: (target: ProjectFileLink) => void;
  /** Shows some inline code as something else, like a finding's `F1`. */
  inlineCode?: (value: string) => ReactNode | undefined;
  /** Shows an `![alt](src)`; undefined leaves it to the default, which only draws data URLs. */
  image?: (src: string, alt: string) => ReactNode | undefined;
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
        <CodeBlock
          code={markdownNodeText(node).replace(/\n$/, "")}
          lang={markdownCodeLanguage(node)}
        />
      ),
      a: ({ href, children }) => {
        const target =
          projectRoot && linksFiles && href
            ? projectFileLink(href, projectRoot)
            : null;
        return target ? (
          <FileLinkChip
            target={target}
            onOpen={(target) => openFile.current?.(target)}
          />
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
        const shown = className ? undefined : inlineCode?.(value);
        if (shown) return shown;
        if (!className && looksLikeColor(value) && CSS.supports("color", value))
          return <ColorCode value={value} />;
        const target =
          !className && projectRoot && linksFiles && !value.includes("\n")
            ? projectFileLink(value, projectRoot, true)
            : null;
        return target ? (
          <FileLinkChip
            target={target}
            onOpen={(target) => openFile.current?.(target)}
          />
        ) : (
          <code className={className}>{children}</code>
        );
      },
      img: ({ src, alt }) => {
        if (typeof src !== "string") return null;
        const shown = image?.(src, alt ?? "");
        if (shown !== undefined) return shown;
        // Remote images stay links: loading one would tell its server the thread was read.
        if (/^https?:/i.test(src))
          return (
            <a
              href={src}
              onClick={(e) => {
                e.preventDefault();
                void api.openExternal(src).catch(() => {});
              }}
            >
              {alt || src}
            </a>
          );
        return /^data:image\//i.test(src) ? (
          <img className="markdown-image" src={src} alt={alt ?? ""} />
        ) : null;
      },
    }),
    // A new renderer redraws text that was shown before it arrived.
    [projectRoot, linksFiles, inlineCode, image],
  );
  const blocks = useMemo(() => markdownBlocks(text), [text]);
  // Streaming changes the text every token; keep the map (and the chips
  // reading it) unchanged until a clash actually appears.
  const lastSuffixes = useRef<ReadonlyMap<string, string>>(new Map());
  const suffixes = useMemo(() => {
    const next =
      projectRoot && linksFiles
        ? parentSuffixes(linkedProjectFiles(text, projectRoot))
        : new Map<string, string>();
    const last = lastSuffixes.current;
    if (
      next.size !== last.size ||
      [...next].some(([path, suffix]) => last.get(path) !== suffix)
    )
      lastSuffixes.current = next;
    return lastSuffixes.current;
  }, [text, projectRoot, linksFiles]);
  return (
    <FileLinkSuffixes.Provider value={suffixes}>
      <div className="markdown">
        {blocks.map((block, index) => (
          <Fragment key={index}>
            {index > 0 && "\n"}
            <MarkdownBlock text={block} components={components} />
          </Fragment>
        ))}
      </div>
    </FileLinkSuffixes.Provider>
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
/** "5m ago" while recent, a bare date once relativeDate gives one. */
export function timeAgo(value: string) {
  const rel = relativeDate(value);
  return /^\d+[mhd]$/.test(rel) ? `${rel} ago` : rel;
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
