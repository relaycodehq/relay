import { useDeferredValue, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Code2, Eye, SquareSplitHorizontal } from "lucide-react";
import { imageMime } from "../../../../shared/project-files";
import { api } from "../../../lib/api";
import { persistedStore } from "../../../lib/persisted-store";
import { RichText } from "../../../ui/RichText";
import { IconButton } from "../../../ui/ui";

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

/** A relative image path from the file's folder to the project root, or null if it leaves it. */
function projectPath(from: string, src: string): string | null {
  if (/^[a-z][a-z0-9+.-]*:|^\/\//i.test(src)) return null;
  let clean: string;
  try {
    clean = decodeURI(src.split(/[?#]/)[0]);
  } catch {
    return null;
  }
  const parts = clean.startsWith("/") ? [] : from.split("/").slice(0, -1);
  for (const part of clean.split("/")) {
    if (!part || part === ".") continue;
    if (part !== "..") parts.push(part);
    else if (!parts.pop()) return null;
  }
  return parts.join("/") || null;
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

/** The buffer as it reads, following the edits a beat behind the typing. */
export function MarkdownPreview({
  where,
  path,
  text,
}: {
  where: string;
  path: string;
  text: string;
}) {
  const shown = useDeferredValue(text);
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
    <div className="markdown-preview">
      <RichText text={shown} image={image} />
    </div>
  );
}
