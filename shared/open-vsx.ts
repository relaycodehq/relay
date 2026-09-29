/**
 * VS Code colour themes from Open VSX. Search reads each hit's package.json
 * and keeps extensions that contribute colour themes, since the Themes
 * category also holds icon packs and language tools. Installing reads the
 * .vsix with range requests, the zip's directory and then only the theme
 * files, so a package that ships its node_modules still costs a few hundred
 * kilobytes. Runs on fetch alone, so the desktop app and browser previews
 * share it.
 */
import { parse, type ParseError } from "jsonc-parser";

const API = "https://open-vsx.org/api";
/** The API redirects downloads to its CDN. */
const HOSTS = new Set(["open-vsx.org", "openvsx.eclipsecontent.org"]);
const TIMEOUT = 15_000;
const MAX_THEMES = 40;
const PAGE_SIZE = 5;
const SEARCH_BATCH = 20;
/** A page gives up reading ahead after this many batches. */
const MAX_SEARCH_ROUNDS = 5;
const MAX_THEME_BYTES = 1 << 20;
const MAX_DIRECTORY_BYTES = 4 << 20;
const MAX_INCLUDE_DEPTH = 8;
const EOCD_SEARCH = 22 + 0xffff;

type UiTheme = "vs" | "vs-dark" | "hc-black" | "hc-light";
const uiThemes: UiTheme[] = ["vs", "vs-dark", "hc-black", "hc-light"];

interface ThemeContribution {
  label: string;
  uiTheme: UiTheme;
  path: string;
}

export interface ThemeExtension {
  namespace: string;
  name: string;
  version: string;
  displayName: string;
  description: string;
  downloads: number;
  verified: boolean;
  themes: ThemeContribution[];
}

export type ExtensionRef = Pick<
  ThemeExtension,
  "namespace" | "name" | "version"
>;

interface TokenColor {
  scope?: string | string[];
  settings: { foreground?: string; background?: string; fontStyle?: string };
}

export interface VsCodeTheme {
  label: string;
  uiTheme: UiTheme;
  colors: Record<string, string>;
  tokenColors: TokenColor[];
}

export interface ThemeSearchPage {
  extensions: ThemeExtension[];
  /** Where the next page starts in Open VSX's results; null at the end. */
  next: number | null;
}

/**
 * One page of colour-theme extensions, starting at `offset` in Open VSX's
 * results. Hits that turn out not to be theme extensions are skipped, so the
 * page reads ahead in small batches until it has enough, and `next` points
 * just past the last hit it used.
 */
export async function searchThemes(
  query: string,
  offset = 0,
  signal?: AbortSignal,
): Promise<ThemeSearchPage> {
  const extensions: ThemeExtension[] = [];
  let at = offset;
  for (let round = 0; round < MAX_SEARCH_ROUNDS; round++) {
    const hits = await searchHits(query, at, signal);
    const checked = await Promise.all(
      hits.map((hit) => themeExtension(hit, signal)),
    );
    for (const [i, extension] of checked.entries()) {
      if (extension) extensions.push(extension);
      if (extensions.length === PAGE_SIZE)
        return { extensions, next: at + i + 1 };
    }
    if (hits.length < SEARCH_BATCH) return { extensions, next: null };
    at += hits.length;
  }
  return { extensions, next: at };
}

async function searchHits(query: string, offset: number, signal?: AbortSignal) {
  const params = new URLSearchParams({
    query: query.trim(),
    category: "Themes",
    sortBy: query.trim() ? "relevance" : "downloadCount",
    sortOrder: "desc",
    size: String(SEARCH_BATCH),
    offset: String(offset),
  });
  const result = json(
    await get(`${API}/-/search?${params}`, { limit: 1 << 20, signal }),
  ) as { extensions?: unknown[] };
  return (result.extensions ?? []).map((hit) => hit as Record<string, unknown>);
}

async function themeExtension(
  hit: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<ThemeExtension | null> {
  const ref = {
    namespace: hit.namespace,
    name: hit.name,
    version: hit.version,
  };
  if (!isRef(ref) || hit.deprecated === true) return null;
  try {
    const manifest = json(
      await get(`${base(ref)}/file/package.json`, {
        limit: 256 << 10,
        signal,
      }),
    );
    let themes = contributions(manifest);
    if (!themes.length || isTool(manifest)) return null;
    if (themes.some((t) => isPlaceholder(t.label)))
      themes = await translated(
        themes,
        await openZip(packageUrl(ref), signal),
      ).catch(() => themes);
    return {
      ...ref,
      displayName: text(hit.displayName) || ref.name,
      description: text(hit.description),
      downloads: Number(hit.downloadCount) || 0,
      verified: hit.verified === true,
      themes,
    };
  } catch (error) {
    // Only a broken extension is skipped; a missing one would look like the
    // search had nothing more.
    if (signal?.aborted || (error instanceof OpenVsxError && error.busy))
      throw error;
    return null;
  }
}

/** Every colour theme the extension contributes, includes resolved. */
export async function fetchThemes(
  ref: ExtensionRef,
  signal?: AbortSignal,
): Promise<VsCodeTheme[]> {
  if (!isRef(ref)) throw new Error("That isn't an Open VSX extension.");
  const zip = await openZip(packageUrl(ref), signal);
  const manifest = json(await zip.read("extension/package.json"));
  const themes = await translated(contributions(manifest), zip);
  if (!themes.length) throw new Error("This extension has no colour themes.");
  type Loaded = Pick<VsCodeTheme, "colors" | "tokenColors">;
  const loaded = new Map<string, Promise<Loaded>>();
  const load = (path: string, depth: number): Promise<Loaded> => {
    if (depth > MAX_INCLUDE_DEPTH)
      throw new Error("Theme includes go too deep.");
    let theme = loaded.get(path);
    if (!theme) {
      theme = loadTheme(path, depth);
      loaded.set(path, theme);
    }
    return theme;
  };
  const loadTheme = async (path: string, depth: number): Promise<Loaded> => {
    if (!path.endsWith(".json"))
      throw new Error("Only JSON colour themes can be imported.");
    const doc = json(await zip.read(path)) as Record<string, unknown>;
    const parent: Loaded =
      typeof doc.include === "string"
        ? await load(resolve(path, doc.include), depth + 1)
        : { colors: {}, tokenColors: [] };
    return {
      colors: { ...parent.colors, ...colorsOf(doc.colors) },
      // Later rules win, so the including theme's come last.
      tokenColors: [...parent.tokenColors, ...tokenColorsOf(doc.tokenColors)],
    };
  };
  return Promise.all(
    themes.map(async ({ label, uiTheme, path }) => ({
      label,
      uiTheme,
      ...(await load(resolve("extension/package.json", path), 0)),
    })),
  );
}

// Manifest ------------------------------------------------------------------

function contributions(manifest: unknown): ThemeContribution[] {
  const themes = (manifest as { contributes?: { themes?: unknown } })
    ?.contributes?.themes;
  if (!Array.isArray(themes)) return [];
  return themes
    .flatMap((t: Record<string, unknown>) =>
      typeof t?.label === "string" &&
      typeof t.path === "string" &&
      uiThemes.includes(t.uiTheme as UiTheme)
        ? [{ label: t.label, uiTheme: t.uiTheme as UiTheme, path: t.path }]
        : [],
    )
    .slice(0, MAX_THEMES);
}

/**
 * Language support that happens to bundle a colour theme, like PowerShell's
 * ISE look. It isn't what someone browsing themes is after.
 */
function isTool(manifest: unknown): boolean {
  const contributes = (manifest as { contributes?: Record<string, unknown> })
    ?.contributes;
  return ["languages", "debuggers", "grammars"].some(
    (key) =>
      Array.isArray(contributes?.[key]) &&
      (contributes[key] as unknown[]).length > 0,
  );
}

/**
 * Labels like "%theme.dark%" name entries in the package's translations,
 * which Open VSX doesn't serve apart from the package.
 */
async function translated(
  themes: ThemeContribution[],
  zip: Awaited<ReturnType<typeof openZip>>,
): Promise<ThemeContribution[]> {
  if (!themes.some((t) => isPlaceholder(t.label))) return themes;
  const nls = (await zip
    .read("extension/package.nls.json")
    .then(json)
    .catch(() => ({}))) as Record<string, unknown>;
  return themes.map((theme) => {
    if (!isPlaceholder(theme.label)) return theme;
    // Entries are either the text or { message, comment }.
    const entry = nls[theme.label.slice(1, -1)] as
      string | { message?: unknown } | undefined;
    const label = text(typeof entry === "string" ? entry : entry?.message);
    return label ? { ...theme, label } : theme;
  });
}

const packageUrl = (ref: ExtensionRef) =>
  `${base(ref)}/file/${ref.namespace}.${ref.name}-${ref.version}.vsix`;

const isPlaceholder = (label: string) => /^%[^%]+%$/.test(label);

function isRef(ref: Record<string, unknown>): ref is ExtensionRef {
  const part = (v: unknown) => typeof v === "string" && /^[\w.-]+$/.test(v);
  return part(ref.namespace) && part(ref.name) && part(ref.version);
}

const base = (ref: ExtensionRef) =>
  `${API}/${ref.namespace}/${ref.name}/${ref.version}`;

/** A package path relative to `from`, which must stay inside the extension. */
function resolve(from: string, relative: string): string {
  if (relative.includes("\0") || /^([a-z]+:|[\\/])/i.test(relative))
    throw new Error(`Theme path ${relative} leaves the extension.`);
  const parts = from.split("/").slice(0, -1);
  for (const part of relative.split(/[\\/]/)) {
    if (part === "..") parts.pop();
    else if (part && part !== ".") parts.push(part);
  }
  if (parts[0] !== "extension" || parts.length < 2)
    throw new Error(`Theme path ${relative} leaves the extension.`);
  return parts.join("/");
}

// Theme files ---------------------------------------------------------------

const isColor = (v: unknown): v is string =>
  typeof v === "string" &&
  /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v);

function colorsOf(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object") return {};
  return Object.fromEntries(
    Object.entries(value).filter(([, color]) => isColor(color)),
  );
}

/** Only colours and font styles survive; they end up in inline styles. */
function tokenColorsOf(value: unknown): TokenColor[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((rule: Record<string, unknown>) => {
    const settings = rule?.settings as Record<string, unknown> | undefined;
    if (!settings || typeof settings !== "object") return [];
    const scope = rule.scope;
    const clean: TokenColor["settings"] = {};
    if (isColor(settings.foreground)) clean.foreground = settings.foreground;
    if (isColor(settings.background)) clean.background = settings.background;
    if (
      typeof settings.fontStyle === "string" &&
      /^[a-z ]*$/.test(settings.fontStyle)
    )
      clean.fontStyle = settings.fontStyle;
    if (!Object.keys(clean).length) return [];
    return [
      {
        ...(typeof scope === "string" ||
        (Array.isArray(scope) && scope.every((s) => typeof s === "string"))
          ? { scope }
          : {}),
        settings: clean,
      },
    ];
  });
}

// Zip over HTTP ranges ------------------------------------------------------

interface ZipEntry {
  method: number;
  compressed: number;
  size: number;
  offset: number;
}

async function openZip(url: string, signal?: AbortSignal) {
  // Neither the API nor its CDN serves suffix ranges, so learn the size
  // first; later ranges go straight to the CDN the API redirects to.
  const { url: cdn, size: total } = await head(url, signal);
  const from = Math.max(0, total - EOCD_SEARCH);
  const tail = await get(cdn, {
    range: `bytes=${from}-${total - 1}`,
    limit: EOCD_SEARCH,
    signal,
  });
  const end = findEndOfDirectory(tail.bytes);
  const view = dataView(tail.bytes);
  const count = view.getUint16(end + 10, true);
  const size = view.getUint32(end + 12, true);
  const offset = view.getUint32(end + 16, true);
  if (count === 0xffff || size === 0xffffffff || offset === 0xffffffff)
    throw new Error("Large (ZIP64) packages aren't supported.");
  if (size > MAX_DIRECTORY_BYTES)
    throw new Error("This package lists too many files.");
  const directory = await get(cdn, {
    range: `bytes=${offset}-${offset + size - 1}`,
    limit: size,
    signal,
  });
  const entries = readDirectory(directory.bytes, count);

  return {
    async read(name: string) {
      const entry = entries.get(name);
      if (!entry) throw new Error(`The package has no ${name}.`);
      if (entry.size > MAX_THEME_BYTES || entry.compressed > MAX_THEME_BYTES)
        throw new Error(`${name} is too large for a theme.`);
      // The local header repeats the name and may carry its own extra field;
      // guess generously and fetch again if it's longer.
      const fetchData = async (extra: number) => {
        const length = 30 + name.length + extra + entry.compressed;
        const { bytes } = await get(cdn, {
          range: `bytes=${entry.offset}-${entry.offset + length - 1}`,
          limit: length,
          signal,
        });
        const local = dataView(bytes);
        if (bytes.length < 30 || local.getUint32(0, true) !== 0x04034b50)
          throw new Error("The package is damaged.");
        const start =
          30 + local.getUint16(26, true) + local.getUint16(28, true);
        return { bytes, start, needed: start - 30 - name.length };
      };
      let data = await fetchData(1024);
      if (data.start + entry.compressed > data.bytes.length)
        data = await fetchData(data.needed);
      const body = data.bytes.subarray(
        data.start,
        data.start + entry.compressed,
      );
      if (entry.method === 0) return body;
      if (entry.method !== 8)
        throw new Error(`${name} uses an unsupported compression.`);
      const stream = new Blob([body as BlobPart])
        .stream()
        .pipeThrough(new DecompressionStream("deflate-raw"));
      return readCapped(stream, MAX_THEME_BYTES);
    },
  };
}

function findEndOfDirectory(bytes: Uint8Array): number {
  const view = dataView(bytes);
  for (let at = bytes.length - 22; at >= 0; at--) {
    // A comment could contain the signature; the real record's comment
    // length reaches exactly to the end.
    if (
      view.getUint32(at, true) === 0x06054b50 &&
      at + 22 + view.getUint16(at + 20, true) === bytes.length
    )
      return at;
  }
  throw new Error("The package isn't a zip file.");
}

function readDirectory(bytes: Uint8Array, count: number) {
  const view = dataView(bytes);
  const decoder = new TextDecoder();
  const entries = new Map<string, ZipEntry>();
  let at = 0;
  for (let i = 0; i < count; i++) {
    if (at + 46 > bytes.length || view.getUint32(at, true) !== 0x02014b50)
      throw new Error("The package is damaged.");
    const nameLength = view.getUint16(at + 28, true);
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    entries.set(name, {
      method: view.getUint16(at + 10, true),
      compressed: view.getUint32(at + 20, true),
      size: view.getUint32(at + 24, true),
      offset: view.getUint32(at + 42, true),
    });
    at +=
      46 +
      nameLength +
      view.getUint16(at + 30, true) +
      view.getUint16(at + 32, true);
  }
  return entries;
}

// HTTP ------------------------------------------------------------------------

async function head(url: string, signal?: AbortSignal) {
  const response = await fetch(url, {
    method: "HEAD",
    signal: timeout(signal),
  });
  checkResponse(response);
  const size = Number(response.headers.get("content-length"));
  if (!(size > 0))
    throw new Error("Open VSX didn't say how big the package is.");
  return { url: response.url, size };
}

async function get(
  url: string,
  {
    limit,
    range,
    signal,
  }: { limit: number; range?: string; signal?: AbortSignal },
) {
  const response = await fetch(url, {
    headers: range ? { Range: range } : undefined,
    signal: timeout(signal),
  });
  checkResponse(response);
  // Ignoring a range would mean downloading the whole package.
  if (range && response.status !== 206)
    throw new Error("Open VSX didn't answer a partial download.");
  if (!response.body) throw new Error("Open VSX sent nothing.");
  return { url: response.url, bytes: await readCapped(response.body, limit) };
}

function checkResponse(response: Response) {
  if (!HOSTS.has(new URL(response.url).hostname))
    throw new Error("Open VSX redirected somewhere unexpected.");
  if (response.ok) return;
  const busy = response.status === 429 || response.status >= 500;
  throw new OpenVsxError(
    busy
      ? "Open VSX is busy right now. Try again in a moment."
      : `Open VSX answered ${response.status}.`,
    busy,
  );
}

class OpenVsxError extends Error {
  /** A retry could work; a page shouldn't quietly drop what failed. */
  readonly busy: boolean;
  constructor(message: string, busy: boolean) {
    super(message);
    this.busy = busy;
  }
}

const timeout = (signal?: AbortSignal) =>
  signal
    ? AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT)])
    : AbortSignal.timeout(TIMEOUT);

async function readCapped(
  stream: ReadableStream<Uint8Array>,
  limit: number,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > limit) {
      await reader.cancel();
      throw new Error("Open VSX sent more than expected.");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.length;
  }
  return bytes;
}

function json(input: { bytes: Uint8Array } | Uint8Array): unknown {
  const bytes = input instanceof Uint8Array ? input : input.bytes;
  const errors: ParseError[] = [];
  const value = parse(new TextDecoder().decode(bytes), errors, {
    allowTrailingComma: true,
  });
  if (errors.length) throw new Error("A theme file isn't valid JSON.");
  return value;
}

const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");

const dataView = (bytes: Uint8Array) =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
