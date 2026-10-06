// Decides from text alone whether a Markdown link destination or an inline
// code span names a file, and splits off its line. Whether the file is in the
// project is the caller's business. Runs on the phone too, so no `URL`.

export type LinkPosition = {
  path: string;
  line?: number;
  column?: number;
};

const POSITION = /:(\d+)(?::(\d+))?$/;
const WINDOWS_ABSOLUTE = /^[A-Za-z]:[/\\]/;
const EXPLICIT_RELATIVE = /^(?:~\/|\.\/|\.\.\/)/;
const EXTENSION = /\.[\w-]+$/;
const WORDS = "[A-Za-z0-9._-]+(?: [A-Za-z0-9._-]+)*";
const RELATIVE_WITH_DIRECTORIES = new RegExp(
  `^${WORDS}(?:/${WORDS})+(?::\\d+){0,2}$`,
);
const BARE_NAME = new RegExp(`^${WORDS}$`);

function words(list: string) {
  return list.split(" ");
}

const GENERIC_TLDS = new Set(
  words(
    "com net org io dev app ai co edu gov mil info biz xyz me tv cc gg chat cloud site online tech store link",
  ),
);
// Skipped when a position follows: `foo.pl:3` is a Perl file, not a host.
const COUNTRY_TLDS = new Set(
  words(
    "uk de fr nl se no fi dk pl ch at be es it pt eu us ca au nz jp kr cn br ru mx ie cz tr sg hk",
  ),
);

const OS_ROOTS = words(
  "Users home tmp var etc opt mnt Volumes private root usr bin sbin lib lib64 srv dev proc sys run boot media workspace workspaces",
).map((root) => `/${root}/`);

const EXTENSIONLESS_FILES = new Set(
  words(
    "Makefile makefile GNUmakefile Dockerfile Containerfile Justfile justfile Rakefile Gemfile Procfile Brewfile Caddyfile Vagrantfile Jenkinsfile Podfile Fastfile BUILD WORKSPACE LICENSE LICENCE COPYING NOTICE AUTHORS CONTRIBUTORS CHANGELOG README CODEOWNERS",
  ),
);

/**
 * For the text of an inline code span: a normalised path-like string to feed to
 * resolveFileLink, or null when it should not be treated as a path at all.
 * Stricter than links, since inline code is mostly branches, hosts and prose.
 */
export function filePathInInlineCode(code: string): string | null {
  const trimmed = code.trim();
  if (!trimmed || /[\s`]/.test(trimmed)) return null;
  const text = WINDOWS_ABSOLUTE.test(trimmed)
    ? trimmed
    : trimmed.replaceAll("\\", "/");
  const position = POSITION.test(text);
  if (!position && !/[/\\]/.test(text)) return null;
  if (
    EXPLICIT_RELATIVE.test(text) ||
    text.startsWith("/") ||
    WINDOWS_ABSOLUTE.test(text)
  )
    return text;

  const bare = text.replace(POSITION, "");
  if (looksLikeHost(bare.split("/")[0]!, position)) return null;
  const last = bare.replace(/\/+$/, "").split("/").at(-1)!;
  if (!position && !EXTENSION.test(last)) return null;
  return text;
}

function looksLikeHost(segment: string, position: boolean) {
  if (segment.startsWith(".")) return false;
  if (segment.toLowerCase() === "localhost") return true;
  if (/^\d+(?:\.\d+)+$/.test(segment)) return true;
  const labels = segment.split(".");
  if (labels.length < 2) return false;
  const tld = labels.at(-1)!.toLowerCase();
  return GENERIC_TLDS.has(tld) || (!position && COUNTRY_TLDS.has(tld));
}

/**
 * For the destination of a Markdown link (or an inline-code candidate): the path with
 * any position split off, or null when the destination is not a file path.
 */
export function resolveFileLink(href: string): LinkPosition | null {
  let destination = href.trim();
  if (destination.startsWith("<") && destination.endsWith(">"))
    destination = destination.slice(1, -1);
  if (
    !destination ||
    destination.startsWith("#") ||
    destination.startsWith("//")
  )
    return null;

  const split = /^file:/i.test(destination)
    ? splitFileUrl(destination.slice("file:".length))
    : splitPathAndHash(destination);
  if (!split) return null;

  let path = decode(split.path.trim());
  const hash = decode(split.hash.trim());
  if (/^\/[A-Za-z]:[/\\]/.test(path)) path = path.slice(1);
  if (!path || isExternal(path)) return null;

  const written = path;
  let line: number | undefined;
  let column: number | undefined;
  const suffix = POSITION.exec(path);
  if (suffix) {
    path = path.slice(0, suffix.index);
    line = positive(suffix[1]);
    column = positive(suffix[2]);
  } else {
    const anchor = /^#L(\d+)(?:C(\d+))?$/i.exec(hash);
    line = positive(anchor?.[1]);
    column = positive(anchor?.[2]);
  }
  if (!isFilePath(path, written)) return null;
  return {
    path,
    ...(line ? { line } : {}),
    // A column means nothing without its line.
    ...(line && column ? { column } : {}),
  };
}

function splitPathAndHash(destination: string) {
  const hashAt = destination.indexOf("#");
  const beforeHash = hashAt < 0 ? destination : destination.slice(0, hashAt);
  const queryAt = beforeHash.indexOf("?");
  return {
    path: queryAt < 0 ? beforeHash : beforeHash.slice(0, queryAt),
    hash: hashAt < 0 ? "" : destination.slice(hashAt),
  };
}

/** `rest` is a file URL after its scheme; only local hosts are files. */
function splitFileUrl(rest: string) {
  let local: string;
  if (rest.startsWith("//")) {
    const authority = rest.slice(2);
    const hostEnd = authority.search(/[/?#]/);
    const host = hostEnd < 0 ? authority : authority.slice(0, hostEnd);
    if (host && host.toLowerCase() !== "localhost") return null;
    local = hostEnd < 0 ? "" : authority.slice(hostEnd);
  } else if (rest.startsWith("/")) local = rest;
  else return null;
  const split = splitPathAndHash(local);
  if (!split.path.startsWith("/")) return null;
  return { ...split, path: removeDotSegments(split.path) };
}

/** What a browser does to a URL's path: `.` drops out, `..` eats its parent. */
function removeDotSegments(path: string) {
  const out: string[] = [];
  const segments = path.split("/");
  segments.forEach((segment, i) => {
    const last = i === segments.length - 1;
    if (segment === "." || segment === "..") {
      if (segment === ".." && out.length > 1) out.pop();
      if (last) out.push("");
    } else out.push(segment);
  });
  return out.join("/");
}

function decode(text: string) {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

/** A URL scheme, unless what follows the colon is a drive path or a position. */
function isExternal(path: string) {
  const scheme = /^[A-Za-z][A-Za-z0-9+.-]*:([^]*)$/.exec(path);
  if (!scheme) return false;
  const rest = scheme[1]!;
  if (WINDOWS_ABSOLUTE.test(path)) return false;
  if (rest.startsWith("//")) return true;
  return !/^\d+(?::\d+)?$/.test(rest);
}

/** Lines and columns above the safe-integer range are noise, not positions. */
function positive(digits: string | undefined) {
  if (!digits) return undefined;
  const value = Number.parseInt(digits, 10);
  return value > 0 && Number.isSafeInteger(value) ? value : undefined;
}

/** `path` has its position removed, `written` still carries it. */
function isFilePath(path: string, written: string) {
  if (WINDOWS_ABSOLUTE.test(path) || EXPLICIT_RELATIVE.test(path)) return true;
  if (path.startsWith("/")) {
    const last = written.split("/").at(-1)!;
    return (
      OS_ROOTS.some((root) => written.startsWith(root)) ||
      POSITION.test(written) ||
      EXTENSIONLESS_FILES.has(last) ||
      EXTENSION.test(last)
    );
  }
  if (EXTENSIONLESS_FILES.has(path)) return true;
  return (
    RELATIVE_WITH_DIRECTORIES.test(written) ||
    (BARE_NAME.test(path) && EXTENSION.test(path))
  );
}
