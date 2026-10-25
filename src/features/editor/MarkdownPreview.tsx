import {
  useDeferredValue,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import { useQuery } from "@tanstack/react-query";
import { Code2, Eye, SquareSplitHorizontal } from "lucide-react";
import { imageMime } from "../../../shared/project-files";
import { api } from "../../lib/api";
import { persistedStore } from "../../lib/persisted-store";
import { RichText } from "../../ui/RichText";
import { Splitter } from "../../ui/Splitter";
import { IconButton } from "../../ui/ui";
import { markdownLink, projectPath } from "./markdown-links";
import { useMarkdownLinks } from "./useMarkdownLinks";

export type MarkdownMode = "code" | "split" | "preview";

export const isMarkdown = (path: string) => /\.(md|markdown|mdx)$/i.test(path);

const modes = persistedStore<MarkdownMode>(
  "relay-markdown-mode",
  (saved) => (saved === "code" || saved === "preview" ? saved : "split"),
  (mode) => mode,
);

/** How Markdown files open, the same for every one of them. */
export function useMarkdownMode() {
  return [modes.use(), modes.set] as const;
}

/** The code's share of the width in Split. */
const shares = persistedStore<number>(
  "relay-markdown-split",
  (saved) => {
    const share = Number(saved);
    return share >= 0.2 && share <= 0.8 ? share : 0.5;
  },
  String,
);

function useMarkdownSplit() {
  return [shares.use(), shares.set] as const;
}

function MarkdownSplitter({
  share,
  onShare,
}: {
  share: number;
  onShare: (share: number) => void;
}) {
  return (
    <Splitter
      className="markdown-splitter"
      label="Resize code and preview"
      value={Math.round(share * 100)}
      min={20}
      max={80}
      begin={(handle) => {
        const width = handle.parentElement!.clientWidth;
        return (delta) =>
          onShare(Math.max(0.2, Math.min(0.8, share + delta / width)));
      }}
      onReset={() => onShare(0.5)}
    />
  );
}

export function MarkdownModes({
  mode,
  onMode,
}: {
  mode: MarkdownMode;
  onMode: (mode: MarkdownMode) => void;
}) {
  return (
    <>
      <IconButton
        label="Code"
        active={mode === "code"}
        onClick={() => onMode("code")}
      >
        <Code2 size={15} />
      </IconButton>
      <IconButton
        label="Code and preview"
        active={mode === "split"}
        onClick={() => onMode("split")}
      >
        <SquareSplitHorizontal size={15} />
      </IconButton>
      <IconButton
        label="Preview"
        active={mode === "preview"}
        onClick={() => onMode("preview")}
      >
        <Eye size={15} />
      </IconButton>
      <span className="divider" />
    </>
  );
}

function LocalImage({
  where,
  path,
  alt,
}: {
  where: string;
  path: string;
  alt: string;
}) {
  const image = useQuery({
    queryKey: ["project-image", where, path],
    queryFn: () => api.projectImage(where, path),
    staleTime: 30_000,
    retry: false,
  });
  if (image.data) return <img className="markdown-image" src={image.data} alt={alt} />;
  if (image.isError) return <span className="markdown-preview-missing">{alt || path}</span>;
  return null;
}

/**
 * The buffer as it reads, updating a beat after the typing. A `#section` link
 * scrolls to its heading and a relative link opens its file or folder through
 * `onOpen`. A link that leads nowhere says so.
 */
export function MarkdownPreview({
  where,
  path,
  text,
  onOpen,
}: {
  where: string;
  path: string;
  text: string;
  onOpen?: (target: { path: string; directory: boolean }) => void;
}) {
  const shown = useDeferredValue(text);
  const box = useRef<HTMLDivElement>(null);
  const { notice, follow } = useMarkdownLinks({ where, path, box, onOpen });
  const followRef = useRef(follow);
  followRef.current = follow;
  const link = useMemo(
    () => (href: string, children: ReactNode) =>
      markdownLink("", href) ? (
        <a
          href={href}
          onClick={(e) => {
            e.preventDefault();
            void followRef.current(href);
          }}
        >
          {children}
        </a>
      ) : undefined,
    [],
  );
  const image = useMemo(
    () => (src: string, alt: string) => {
      const target = projectPath(path, src);
      return target && imageMime(target) ? (
        <LocalImage where={where} path={target} alt={alt} />
      ) : undefined;
    },
    [where, path],
  );
  return (
    <>
      <div className="markdown-preview" ref={box}>
        <RichText text={shown} image={image} link={link} html />
      </div>
      {notice && (
        <p className="markdown-preview-notice" role="status">
          {notice}
        </p>
      )}
    </>
  );
}

/**
 * The code and its preview side by side, by `mode`. The code stays mounted in
 * Preview, so the editor keeps its scroll.
 */
export function MarkdownSplitView({
  mode,
  where,
  path,
  text,
  onOpenLink,
  children,
}: {
  mode: MarkdownMode;
  where: string;
  path: string;
  text: string;
  onOpenLink?: (target: { path: string; directory: boolean }) => void;
  /** The code editor. */
  children: ReactNode;
}) {
  const [share, setShare] = useMarkdownSplit();
  return (
    <div className={`markdown-split ${mode}`}>
      <div
        className="markdown-split-code"
        hidden={mode === "preview"}
        style={mode === "split" ? { flex: `0 0 ${share * 100}%` } : undefined}
      >
        {children}
      </div>
      {mode === "split" && <MarkdownSplitter share={share} onShare={setShare} />}
      {mode !== "code" && (
        <MarkdownPreview where={where} path={path} text={text} onOpen={onOpenLink} />
      )}
    </div>
  );
}
