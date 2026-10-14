/** An image Relay can show, by its name. */
export const isImagePath = (path: string) =>
  /\.(?:png|jpe?g|gif|webp)$/i.test(path);

/** A video Relay can play, by its name. */
export const isVideoPath = (path: string) =>
  /\.(?:mp4|m4v|webm|mov)$/i.test(path);

/** Tells an agent its answers can show pictures; they rarely think to on their own. */
export const ANSWER_IMAGE_PROMPT =
  "To show the user a PNG, JPEG, GIF or WebP file on this computer, like a screenshot you took or an image they asked to see, embed it in your reply as ![short description](/absolute/path.png); it renders inline. An MP4, WebM or MOV video embeds the same way and plays inline. A screenshot tool that returned only the picture left no file: have it save one (some take save_to_disk) or write the image to a file yourself first. Save screenshots in the system temp folder, never inside the project, so they don't show up in the user's changes. Web image URLs show only as links.";

// A destination in <angle brackets> may hold spaces, like a macOS app data path.
const markdownImage =
  /!\[[^\]\n]*\]\(\s*(?:<([^<>\n]+)>|([^\s<>()]+))(?:\s+["'][^"'\n]*["'])?\s*\)/g;

/**
 * The file on this computer `src` of an answer's `![alt](src)` points at, or
 * null when it's remote. Relative paths resolve against the thread's folder.
 */
function localPath(src: string, root: string): string | null {
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
  if (/^[a-z]:[\\/]/i.test(path)) return path;
  const parts: string[] = [];
  for (const part of (path.startsWith("/") ? path : `${root}/${path}`).split(
    "/",
  )) {
    if (part === "..") parts.pop();
    else if (part && part !== ".") parts.push(part);
  }
  return `/${parts.join("/")}`;
}

/** The image file an answer's `![alt](src)` shows, or null when it isn't one on this computer. */
export function localImagePath(src: string, root: string): string | null {
  const path = localPath(src, root);
  return path && isImagePath(path) ? path : null;
}

/** The video file an answer's `![alt](src)` plays, or null when it isn't one on this computer. */
export function localVideoPath(src: string, root: string): string | null {
  const path = localPath(src, root);
  return path && isVideoPath(path) ? path : null;
}

/** Whether an answer embeds any `![alt](src)` at all. */
export const embedsImages = (body: string) =>
  new RegExp(markdownImage.source).test(body);

const embedded = (
  body: string,
  root: string,
  local: (src: string, root: string) => string | null,
) => {
  const paths = new Set<string>();
  for (const [, bracketed, bare] of body.matchAll(markdownImage)) {
    const path = local((bracketed ?? bare)!, root);
    if (path) paths.add(path);
  }
  return [...paths];
};

/** The local image files an answer embeds, so only those can be read for it. */
export const answerImagePaths = (body: string, root: string) =>
  embedded(body, root, localImagePath);

/** The local video files an answer embeds, so only those can be played for it. */
export const answerVideoPaths = (body: string, root: string) =>
  embedded(body, root, localVideoPath);
