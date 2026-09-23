import { filePathSchema } from "../../shared/validation";
import {
  inlineCodeFilePathCandidate,
  parseMarkdownFileLink,
} from "../vendor/t3code/markdownLinks";

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
