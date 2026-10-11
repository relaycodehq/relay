import {
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Code2, Eye, SquareSplitHorizontal } from "lucide-react";
import { imageMime } from "../../../../shared/project-files";
import { api } from "../../../lib/api";
import { persistedStore } from "../../../lib/persisted-store";
import { RichText } from "../../../ui/RichText";
import { Splitter } from "../../../ui/Splitter";
import { IconButton } from "../../../ui/ui";
import { headingSlugs, markdownLink, projectPath } from "./markdown-links";

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

// The code's share of the width in Split.
const shares = persistedStore<number>(
  "relay-markdown-split",
  (saved) => {
    const share = Number(saved);
    return share >= 0.2 && share <= 0.8 ? share : 0.5;
  },
  String,
);

export function useMarkdownSplit() {
  return [shares.use(), shares.set] as const;
}

export function MarkdownSplitter({
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
  return image.data ? (
    <img className="markdown-image" src={image.data} alt={alt} />
  ) : image.isError ? (
    <span className="markdown-preview-missing">{alt || path}</span>
  ) : null;
}

/** The heading `id` names in `root`, by GitHub's anchors or a sanitized HTML id. */
function findSection(root: HTMLElement, id: string) {
  const named = root.querySelector<HTMLElement>(
    `[id="user-content-${CSS.escape(id)}"], [name="user-content-${CSS.escape(id)}"]`,
  );
  if (named) return named;
  const headings = [
    ...root.querySelectorAll<HTMLElement>("h1, h2, h3, h4, h5, h6"),
  ];
  const slugs = headingSlugs(headings.map((h) => h.textContent ?? ""));
  return headings[slugs.indexOf(id.toLowerCase())];
}

/**
 * The buffer as it reads, following the edits a beat behind the typing. A
 * `#section` link scrolls to its heading and a relative link opens its file
 * or folder through `onOpen`; one that leads nowhere says so.
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
  const qc = useQueryClient();
  const [notice, setNotice] = useState("");
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 4000);
    return () => clearTimeout(timer);
  }, [notice]);
  const follow = async (href: string) => {
    const target = markdownLink(path, href);
    if (!target) return;
    setNotice("");
    if (target.kind === "outside")
      return setNotice(`${href} leads outside this project.`);
    if (target.kind === "section") {
      const heading = box.current && findSection(box.current, target.id);
      if (!heading) return setNotice(`No “${target.id}” section in this file.`);
      heading.scrollIntoView({ block: "start" });
      return;
    }
    if (!onOpen || target.path === path) return;
    const files = qc.getQueryData<string[]>(["project-files", where]);
    if (files?.includes(target.path))
      return onOpen({ path: target.path, directory: false });
    if (files?.some((file) => file.startsWith(`${target.path}/`)))
      return onOpen({ path: target.path, directory: true });
    // Not listed: ignored by Git, or missing.
    try {
      await api.projectFileInfo(where, target.path);
      onOpen({ path: target.path, directory: false });
    } catch {
      setNotice(`Can’t find ${target.path} in this project.`);
    }
  };
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
