import { filePathSchema } from "./validation";
import {
  inlineCodeFilePathCandidate,
  parseMarkdownFileLink,
} from "./vendor/t3code/markdownLinks";

export type ProjectFileLink = {
  path: string;
  line?: number;
  directory: boolean;
};

/** Whether a link names this file, or a folder that contains it. */
export function linksTo(link: ProjectFileLink, path: string) {
  return link.directory ? path.startsWith(link.path + "/") : path === link.path;
}

/** Resolve T3-style code links inside the linked clone, never outside it. */
export function projectFileLink(
  value: string,
  root: string,
  inline = false,
): ProjectFileLink | null {
  const candidate = inline ? inlineCodeFilePathCandidate(value) : value;
  // T3 deliberately declines extensionless inline paths. A trailing slash is
  // unambiguous enough for Relay's folder browser and stays within this clone.
  const directoryCandidate =
    inline &&
    value.endsWith("/") &&
    value.includes("/") &&
    !value.includes("://") &&
    !/[\s`?#]/.test(value)
      ? value
      : null;
  const parsed = candidate ? parseMarkdownFileLink(candidate) : null;
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
    directory,
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
