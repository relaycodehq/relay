import { filePathSchema } from "./validation";
import {
  filePathInInlineCode,
  isOutsideFilePath,
  resolveFileLink,
} from "./markdown-links";

export type ProjectFileLink = {
  path: string;
  line?: number;
  /** The last line of a cited range, after `line`. */
  endLine?: number;
  directory: boolean;
  /** `path` is absolute (or from `~`), a file outside the project. */
  outside?: boolean;
};

/** `223`, or `223–226` for a range; empty without a line. */
export function linesOf({ line, endLine }: ProjectFileLink, dash: string) {
  return line ? `${line}${endLine ? `${dash}${endLine}` : ""}` : "";
}

/** Whether a link names this file, or a folder that contains it. */
export function linksTo(link: ProjectFileLink, path: string) {
  return link.directory ? path.startsWith(link.path + "/") : path === link.path;
}

/** Resolve file links and inline code paths inside the linked clone, never outside it. */
export function projectFileLink(
  value: string,
  root: string,
  inline = false,
): ProjectFileLink | null {
  const candidate = inline ? filePathInInlineCode(value) : value;
  // Inline paths without an extension are declined as too ambiguous, but a
  // trailing slash is clear enough for the folder browser and stays in the clone.
  const directoryCandidate =
    inline &&
    value.endsWith("/") &&
    value.includes("/") &&
    !value.includes("://") &&
    !/[\s`?#]/.test(value)
      ? value
      : null;
  const parsed = candidate ? resolveFileLink(candidate) : null;
  const target =
    parsed ?? (directoryCandidate ? { path: directoryCandidate } : null);
  if (!target || !root) return null;
  const normalizedRoot = root.replace(/\/+$/, "");
  let path = target.path.replaceAll("\\", "/");
  if (path.startsWith("/")) {
    if (!path.startsWith(normalizedRoot + "/")) return null;
    path = path.slice(normalizedRoot.length + 1);
  } else if (path.startsWith("~/")) return null;
  while (path.startsWith("./")) path = path.slice(2);
  const directory = path.endsWith("/");
  path = path.replace(/\/+$/, "");
  if (!filePathSchema.safeParse(path).success) return null;
  return {
    path,
    ...("line" in target && target.line ? { line: target.line } : {}),
    ...("endLine" in target && target.endLine
      ? { endLine: target.endLine }
      : {}),
    directory,
  };
}

/**
 * A file link in an answer: one in the clone, else a file elsewhere on disk
 * named by its absolute path, like a draft an agent wrote to /tmp.
 */
export function chatFileLink(
  value: string,
  root: string,
  inline = false,
): ProjectFileLink | null {
  const inside = projectFileLink(value, root, inline);
  if (inside || !root) return inside;
  const candidate = inline ? filePathInInlineCode(value) : value;
  const target = candidate ? resolveFileLink(candidate) : null;
  if (!target || !isOutsideFilePath(target.path)) return null;
  // What the clone itself turned down stays text.
  if (target.path.startsWith(root.replace(/\/+$/, "") + "/")) return null;
  return {
    path: target.path,
    ...(target.line ? { line: target.line } : {}),
    ...(target.endLine ? { endLine: target.endLine } : {}),
    directory: false,
    outside: true,
  };
}

/** `/tmp/a/b.md` → `{ folder: "/tmp/a", name: "b.md" }`. */
export function splitOutsidePath(path: string) {
  const at = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  const folder = path.slice(0, at);
  return {
    // A bare `C:` is that drive's current folder, not its root.
    folder:
      at === 0 ? "/" : /^[A-Za-z]:$/.test(folder) ? folder + "\\" : folder,
    name: path.slice(at + 1),
  };
}

/**
 * The paths a link names. Agents often cite a bare `name.ts:33` or a path
 * from inside the project, so without an exact hit this falls back to paths
 * that end with it.
 */
export function matchLink(link: ProjectFileLink, paths: readonly string[]) {
  const exact = paths.filter((p) => linksTo(link, p));
  if (exact.length || link.directory) return exact;
  return paths.filter((p) => p.endsWith("/" + link.path));
}
