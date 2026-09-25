/**
 * Font families installed on this computer. The Local Font Access API lists
 * all of them where it's allowed, which the desktop app grants; elsewhere a
 * list of common families is checked one by one.
 */
export interface FontFamily {
  family: string;
  mono: boolean;
}

const common = [
  "Inter",
  "Geist",
  "Helvetica Neue",
  "Helvetica",
  "Arial",
  "Avenir Next",
  "IBM Plex Sans",
  "Segoe UI",
  "Roboto",
  "Noto Sans",
  "Open Sans",
  "Source Sans 3",
  "Ubuntu",
  "Cantarell",
  "Georgia",
  "Charter",
  "Iowan Old Style",
  "SF Mono",
  "Menlo",
  "Monaco",
  "JetBrains Mono",
  "Fira Code",
  "Cascadia Code",
  "Consolas",
  "Source Code Pro",
  "IBM Plex Mono",
  "Geist Mono",
  "Berkeley Mono",
  "Commit Mono",
  "Monaspace Neon",
  "Iosevka",
  "Hack",
  "Victor Mono",
  "Roboto Mono",
  "Ubuntu Mono",
  "DejaVu Sans Mono",
  "Liberation Mono",
  "Courier New",
];

let families: Promise<FontFamily[]> | undefined;

export function installedFonts(): Promise<FontFamily[]> {
  families ??= fromSystem()
    .catch(() => [])
    .then(async (found) => (found.length ? found : fromCommon()));
  return families;
}

async function fromSystem(): Promise<FontFamily[]> {
  const query = (
    window as { queryLocalFonts?: () => Promise<{ family: string }[]> }
  ).queryLocalFonts;
  if (!query) return [];
  const fonts = await query();
  // Dot-prefixed families are the system's private faces.
  return [...new Set(fonts.map((f) => f.family))]
    .filter((family) => family && !family.startsWith("."))
    .sort((a, b) => a.localeCompare(b))
    .map(describe);
}

function fromCommon(): FontFamily[] {
  return common
    .filter(isFontInstalled)
    .sort((a, b) => a.localeCompare(b))
    .map(describe);
}

const describe = (family: string): FontFamily => ({
  family,
  mono: isMonospace(family),
});

let canvas: CanvasRenderingContext2D | null | undefined;
function measure(font: string, text: string) {
  canvas ??= document.createElement("canvas").getContext("2d");
  if (!canvas) return 0;
  canvas.font = font;
  return canvas.measureText(text).width;
}

const quoted = (family: string) => `"${family.replace(/["\\]/g, "")}"`;

/** Narrow and wide letters take the same room in a monospaced face. */
function isMonospace(family: string) {
  const font = `40px ${quoted(family)}, serif`;
  return measure(font, "iiiiiiiiii") === measure(font, "MMMMMMMMMM");
}

/**
 * Whether `family` is installed. `document.fonts.check` says yes to fonts it
 * has never heard of, so this measures text against two fallbacks instead.
 */
export function isFontInstalled(family: string): boolean {
  const sample = "mmmmmmmmmmlli10OQ@#";
  return ["monospace", "serif"].some(
    (fallback) =>
      measure(`72px ${quoted(family)}, ${fallback}`, sample) !==
      measure(`72px ${fallback}`, sample),
  );
}
