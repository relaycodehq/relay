import {
  createContext,
  Fragment,
  memo,
  useContext,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import { Copy, Check } from "lucide-react";
import Markdown, {
  defaultUrlTransform,
  type Components,
  type UrlTransform,
} from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Position } from "unist";
import { streamingMarkdownTail } from "./markdown-incremental";
import {
  projectFileLink,
  type ProjectFileLink,
} from "../../shared/project-file-links";
import { api } from "../lib/api";
import { looksLikeColor } from "../lib/color-value";
import { parentSuffixes } from "../lib/file-icons";
import { fenceClosed, markdownBlocks } from "../lib/markdown-blocks";
import { inlineCommand } from "../lib/shell-command";
import { useCopy } from "../lib/useCopy";
import { CodeBlock, InlineCommand } from "./CodeBlock";
import { ColorCode } from "./ColorCode";
import { FileEntryIcon } from "./FileEntryIcon";
import { MarkdownTable } from "./MarkdownTable";

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
/** What the block being rendered was parsed from, for its fences to check. */
const MarkdownSource = createContext("");
function MarkdownFence({ node }: { node?: { position?: Position } }) {
  const source = useContext(MarkdownSource);
  return (
    <CodeBlock
      code={markdownNodeText(node).replace(/\n$/, "")}
      lang={markdownCodeLanguage(node)}
      closed={fenceClosed(source, node?.position)}
    />
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

/** File chip: type icon, file name, and a line when there is one. */
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
  const remarkPlugins = useMemo(() => [remarkGfm, streamingMarkdownTail()], []);
  return (
    <MarkdownSource.Provider value={text}>
      <Markdown
        remarkPlugins={remarkPlugins}
        components={components}
        urlTransform={urlTransform}
      >
        {text}
      </Markdown>
    </MarkdownSource.Provider>
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
      pre: ({ node }) => <MarkdownFence node={node} />,
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
        const command = className ? null : inlineCommand(value);
        return target ? (
          <FileLinkChip
            target={target}
            onOpen={(target) => openFile.current?.(target)}
          />
        ) : command ? (
          <InlineCommand command={command}>{children}</InlineCommand>
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
