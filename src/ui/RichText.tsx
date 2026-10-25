import {
  Children,
  cloneElement,
  createContext,
  Fragment,
  isValidElement,
  memo,
  useContext,
  useMemo,
  useRef,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import { Copy, Check } from "lucide-react";
import Markdown, {
  defaultUrlTransform,
  type Components,
  type UrlTransform,
} from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import type { Position } from "unist";
import type { PluggableList } from "unified";
import { streamingMarkdownTail } from "./markdown-incremental";
import { keepIndent, typedSyntax } from "./typed-markdown";
import {
  chatFileLink,
  type ProjectFileLink,
} from "../../shared/project-file-links";
import { api } from "../lib/api";
import { looksLikeColor } from "../lib/color-value";
import { parentSuffixes } from "../lib/file-icons";
import { normalizeFileCitations } from "../lib/file-citations";
import {
  fenceClosed,
  markdownBlocks,
  mathClosed,
} from "../lib/markdown-blocks";
import { bracketSpacedImagePaths } from "../../shared/answer-images";
import { normalizeMath } from "../../shared/math-delimiters";
import { inlineCommand } from "../lib/shell-command";
import { useCopy } from "../lib/useCopy";
import { CodeBlock, InlineCommand } from "./CodeBlock";
import { ColorCode } from "./ColorCode";
import {
  FileLinkChip,
  FileLinkSuffixes,
  linkedProjectFiles,
} from "./FileLinkChip";
import { MarkdownTable } from "./MarkdownTable";
import { KeepBlock, KeepBlockButton } from "./KeepBlock";
import { BlockMath, InlineMath } from "./MathView";

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

/** The markdown `node` was parsed from, cut out of the block's source. */
function nodeSource(source: string, node?: { position?: Position }) {
  const start = node?.position?.start.offset,
    end = node?.position?.end.offset;
  return start === undefined || end === undefined
    ? ""
    : source.slice(start, end);
}

/** The pin that keeps `node`'s markdown in the thread's notes. */
function KeepNode({
  node,
  className,
}: {
  node?: { position?: Position };
  className: string;
}) {
  const source = useContext(MarkdownSource);
  return (
    <KeepBlockButton source={nodeSource(source, node)} className={className} />
  );
}

type ListProps = HTMLAttributes<HTMLElement> & {
  start?: number;
  node?: { position?: Position };
};

/**
 * A list, with a pin to keep it when it stands at the top level of a thread
 * that keeps notes; its frame takes over the list's margins.
 */
function MarkdownList({
  node,
  ordered,
  children,
  ...props
}: ListProps & { ordered: boolean }) {
  const keeper = useContext(KeepBlock);
  const depth = useContext(ListDepth);
  const List = ordered ? "ol" : "ul";
  let n = props.start ?? 1;
  const items = Children.map(children, (child) =>
    isValidElement<ItemProps>(child) && child.type === MarkdownItem
      ? cloneElement(child, {
          marker: ordered ? `${n++}.` : BULLETS[Math.min(depth, 2)],
        })
      : child,
  );
  const list = (
    <ListDepth.Provider value={depth + 1}>
      <List {...props}>{items}</List>
    </ListDepth.Provider>
  );
  if (!keeper || node?.position?.start.column !== 1) return list;
  return (
    <div className="markdown-list">
      {list}
      <KeepNode node={node} className="markdown-list-keep" />
    </div>
  );
}

/** How deep the list being rendered is nested, for its bullet. */
const ListDepth = createContext(0);
const BULLETS = ["•", "◦", "▪"];

type ItemProps = HTMLAttributes<HTMLLIElement> & {
  node?: unknown;
  marker?: string;
};

/**
 * A list item whose bullet or number is text, not a `::marker`, so a
 * selection takes it along. aria-hidden keeps it out of what Keep writes,
 * which numbers lists itself. A task item's checkbox is its marker.
 */
function MarkdownItem({ node: _node, marker, children, ...props }: ItemProps) {
  if (!marker || props.className?.includes("task-list-item"))
    return <li {...props}>{children}</li>;
  const text = (
    <span key="marker" className="markdown-item-marker" aria-hidden="true">
      <span>
        {BULLETS.includes(marker) ? (
          <span className="markdown-item-bullet" data-bullet={marker}>
            {marker}
          </span>
        ) : (
          marker
        )}
        {/* A plain space would end the right-to-left line and jump to its left. */}
        {"\u00a0"}
      </span>
    </span>
  );
  // A loose list wraps each item in paragraphs; outside the first one the
  // marker would copy onto a line of its own.
  const parts = Children.toArray(children);
  const first = parts.findIndex((part) => part !== "\n");
  const lead = parts[first];
  if (isValidElement<{ children?: ReactNode }>(lead) && lead.type === "p")
    parts[first] = cloneElement(lead, {}, text, lead.props.children);
  else parts.unshift(text);
  return (
    <li {...props} className="markdown-item">
      {parts}
    </li>
  );
}

function MarkdownFence({ node }: { node?: { position?: Position } }) {
  const source = useContext(MarkdownSource);
  const lang = markdownCodeLanguage(node);
  if (lang === "math")
    return (
      <BlockMath
        tex={markdownNodeText(node).replace(/\n$/, "")}
        closed={mathClosed(source, node?.position)}
      />
    );
  const closed = fenceClosed(source, node?.position);
  return (
    <CodeBlock
      code={markdownNodeText(node).replace(/\n$/, "")}
      lang={lang}
      closed={closed}
      tools={closed && <KeepNode node={node} className="markdown-code-copy" />}
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

// The default drops data: and file: URLs; an image may use either, a link may not.
const urlTransform: UrlTransform = (url, key, node) =>
  key === "src" &&
  node.tagName === "img" &&
  /^(?:data:image\/|file:)/i.test(url)
    ? url
    : defaultUrlTransform(url);
// GitHub's allowlist, so a README's HTML can't restyle or script the app.
const htmlPlugins = [rehypeRaw, rehypeSanitize];

const MarkdownBlock = memo(function MarkdownBlock({
  text,
  components,
  html,
  typed,
}: {
  text: string;
  components: Components;
  html: boolean;
  typed: boolean;
}) {
  // GFM parses tables, task lists, strikethrough and bare links before the incremental pass.
  // `$x$` is left to normalizeMath: alone it would turn "$5 and $10" into a formula.
  const remarkPlugins = useMemo<PluggableList>(
    () =>
      typed
        ? [remarkGfm, typedSyntax, streamingMarkdownTail("typed")]
        : [
            remarkGfm,
            [remarkMath, { singleDollarTextMath: false }],
            streamingMarkdownTail("answer"),
          ],
    [typed],
  );
  return (
    <MarkdownSource.Provider value={text}>
      <Markdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={html ? htmlPlugins : undefined}
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
  link,
  html = false,
  typed = false,
}: {
  text: string;
  projectRoot?: string;
  onOpenFile?: (target: ProjectFileLink) => void;
  /** Shows some inline code as something else, like a finding's `F1`. */
  inlineCode?: (value: string) => ReactNode | undefined;
  /** Shows an `![alt](src)`; undefined leaves it to the default, which only draws data URLs. */
  image?: (src: string, alt: string) => ReactNode | undefined;
  /** Shows a link that isn't a project file chip; undefined leaves it to the default. */
  link?: (href: string, children: ReactNode) => ReactNode | undefined;
  /** Renders HTML in the text, sanitized, instead of dropping it: for files, not answers. */
  html?: boolean;
  /** Shows text a person typed with its lines and indentation, untypeset; see typedSyntax. */
  typed?: boolean;
}) {
  // Components must keep their identity across renders, or React remounts
  // every code span, table and quote whenever the text changes.
  const openFile = useRef(onOpenFile);
  openFile.current = onOpenFile;
  const linksFiles = !!onOpenFile;
  const components = useMemo<Components>(
    () => ({
      table: ({ children, node }) => (
        <MarkdownTable
          tools={<KeepNode node={node} className="markdown-table-keep" />}
        >
          {children}
        </MarkdownTable>
      ),
      ol: (props) => <MarkdownList {...props} ordered />,
      ul: (props) => <MarkdownList {...props} ordered={false} />,
      li: MarkdownItem,
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
            ? chatFileLink(href, projectRoot)
            : null;
        const shown = !target && href ? link?.(href, children) : undefined;
        if (shown !== undefined) return shown;
        return target && projectRoot ? (
          <FileLinkChip
            target={target}
            root={projectRoot}
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
        if (className?.split(" ").includes("language-math"))
          return <InlineMath tex={String(children).trim()} />;
        const value = String(children).trim();
        const shown = className ? undefined : inlineCode?.(value);
        if (shown) return shown;
        if (!className && looksLikeColor(value) && CSS.supports("color", value))
          return <ColorCode value={value} />;
        const target =
          !className && projectRoot && linksFiles && !value.includes("\n")
            ? chatFileLink(value, projectRoot, true)
            : null;
        const command = className ? null : inlineCommand(value);
        return target && projectRoot ? (
          <FileLinkChip
            target={target}
            root={projectRoot}
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
    [projectRoot, linksFiles, inlineCode, image, link],
  );
  // Citations are read block by block, each kept until its text changes:
  // reading them parses the Markdown, and a streaming answer changes only its
  // last block.
  const citedBlocks = useRef<ReadonlyMap<string, string>>(new Map());
  const blocks = useMemo(() => {
    const split = markdownBlocks(
      typed ? keepIndent(text) : normalizeMath(bracketSpacedImagePaths(text)),
    );
    if (typed || html) return split;
    const last = citedBlocks.current,
      next = new Map<string, string>();
    const cited = split.map((block) => {
      const out = last.get(block) ?? normalizeFileCitations(block);
      next.set(block, out);
      return out;
    });
    citedBlocks.current = next;
    return cited;
  }, [text, typed, html]);
  const linkedText = typed || html ? text : blocks.join("\n");
  // Streaming changes the text every token; keep the map (and the chips
  // reading it) unchanged until a clash actually appears.
  const lastSuffixes = useRef<ReadonlyMap<string, string>>(new Map());
  const suffixes = useMemo(() => {
    const next =
      projectRoot && linksFiles
        ? parentSuffixes(linkedProjectFiles(linkedText, projectRoot))
        : new Map<string, string>();
    const last = lastSuffixes.current;
    if (
      next.size !== last.size ||
      [...next].some(([path, suffix]) => last.get(path) !== suffix)
    )
      lastSuffixes.current = next;
    return lastSuffixes.current;
  }, [linkedText, projectRoot, linksFiles]);
  return (
    <FileLinkSuffixes.Provider value={suffixes}>
      <div className={typed ? "markdown typed" : "markdown"}>
        {blocks.map((block, index) => (
          <Fragment key={index}>
            {index > 0 && "\n"}
            <MarkdownBlock
              text={block}
              components={components}
              html={html}
              typed={typed}
            />
          </Fragment>
        ))}
      </div>
    </FileLinkSuffixes.Provider>
  );
});
