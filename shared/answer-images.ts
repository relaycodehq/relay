import { isImagePath } from "./projects";

const markdownImage =
  /!\[[^\]\n]*\]\(\s*<?([^\s<>()]+)>?(?:\s+["'][^"'\n]*["'])?\s*\)/g;

/**
 * The image file `src` of an answer's `![alt](src)` points at, or null when it
 * isn't one on this computer. Relative paths resolve against the thread's folder.
 */
export function localImagePath(src: string, root: string): string | null {
  let path = src.trim();
  try {
    if (/^file:\/\//i.test(path))
      path = decodeURIComponent(new URL(path).pathname);
    // http:, data: and the like; a Windows drive letter isn't a scheme.
    else if (/^[a-z][a-z\d+.-]*:/i.test(path) && !/^[a-z]:[\\/]/i.test(path))
      return null;
    else path = decodeURIComponent(path);
  } catch {
    return null;
  }
  if (/^[a-z]:[\\/]/i.test(path)) return isImagePath(path) ? path : null;
  const parts: string[] = [];
  for (const part of (path.startsWith("/") ? path : `${root}/${path}`).split(
    "/",
  )) {
    if (part === "..") parts.pop();
    else if (part && part !== ".") parts.push(part);
  }
  const full = `/${parts.join("/")}`;
  return isImagePath(full) ? full : null;
}

/** The local image files an answer embeds, so only those can be read for it. */
export function answerImagePaths(body: string, root: string): string[] {
  const paths = new Set<string>();
  for (const [, src] of body.matchAll(markdownImage)) {
    const path = localImagePath(src!, root);
    if (path) paths.add(path);
  }
  return [...paths];
}
