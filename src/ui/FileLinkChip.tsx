import { createContext, useContext } from "react";
import {
  chatFileLink,
  linesOf,
  type ProjectFileLink,
} from "../../shared/project-file-links";
import { revealLabel } from "../lib/mod-key";
import { FileEntryIcon } from "./FileEntryIcon";

/** Parent folders for file names the message links under several paths. */
export const FileLinkSuffixes = createContext<ReadonlyMap<string, string>>(
  new Map(),
);

/** Every file a message links or names in inline code. */
export function linkedProjectFiles(text: string, root: string): string[] {
  const paths = new Set<string>();
  // Fenced code never becomes a chip; the odd segments are the fences.
  text.split(/(```[\s\S]*?(?:```|$))/).forEach((segment, index) => {
    if (index % 2) return;
    for (const [, href] of segment.matchAll(/\]\(<?([^)\s>]+)/g))
      if (href) {
        const target = chatFileLink(href, root);
        if (target) paths.add(target.path);
      }
    for (const [, code] of segment.matchAll(/`([^`\n]+)`/g))
      if (code) {
        const target = chatFileLink(code.trim(), root, true);
        if (target) paths.add(target.path);
      }
  });
  return [...paths];
}

/** Where a chip points on disk; links inside the project are relative to it. */
function pathOnDisk(target: ProjectFileLink, root: string) {
  if (target.outside) return target.path;
  const separator = root.includes("/") ? "/" : "\\";
  const relative = target.path.replaceAll("/", separator);
  return `${root.replace(/[/\\]+$/, "")}${separator}${relative}`;
}

/** File chip: type icon, file name, and its line or lines when there are some. */
export function FileLinkChip({
  target,
  root,
  onOpen,
}: {
  target: ProjectFileLink;
  root: string;
  onOpen: (target: ProjectFileLink) => void;
}) {
  const suffix = useContext(FileLinkSuffixes).get(target.path);
  const label = [
    target.path.split(/[/\\]/).at(-1) || target.path,
    ...(suffix ? [suffix] : []),
    ...(target.line ? [`L${linesOf(target, "–")}`] : []),
  ].join(" · ");
  return (
    <button
      type="button"
      className="chat-file-link"
      title={`${pathOnDisk(target, root)}${target.line ? `:${linesOf(target, "-")}` : ""}${target.outside && target.directory ? `\n${revealLabel}` : ""}`}
      onClick={() => onOpen(target)}
    >
      <FileEntryIcon path={target.path} directory={target.directory} />
      <span className="chat-file-link-label">{label}</span>
    </button>
  );
}
