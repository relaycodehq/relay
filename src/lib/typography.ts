import { persistedStore } from "./persisted-store";
import { fileSetting, storedBefore } from "./settings-file";

/**
 * Fonts and sizes per surface: the interface, the prompt box, code and the
 * terminal, kept in settings.json. A chosen family goes in
 * front of the default stack, so glyphs it lacks still come from somewhere.
 *
 * The interface size zooms the whole window, spacing included, the way
 * rem-based layouts scale; prompt, code and terminal sizes are divided back
 * out of that zoom so they stay at the size picked for them. The prompt is
 * the exception until it is given a size: it then follows the interface.
 */
export interface Typography {
  /** Empty keeps the default stack. */
  sans: string;
  interfaceSize: number;
  /** Empty follows the interface font. */
  prompt: string;
  /** 0 follows the interface size. */
  promptSize: number;
  mono: string;
  codeSize: number;
  /** Empty follows the code font. */
  terminal: string;
  terminalSize: number;
  smoothing: boolean;
  wrap: boolean;
  /** Shows the prompt and terminal rows; hidden ones keep their values. */
  advanced: boolean;
}

export const DEFAULT_SANS =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif';
export const DEFAULT_MONO =
  'ui-monospace, "SF Mono", Menlo, Consolas, monospace';
/** Relay's own base size; the interface size is measured against it. */
const BASE_SIZE = 13;
export const FOLLOW_INTERFACE = 0;

export const defaultTypography: Typography = {
  sans: "",
  interfaceSize: BASE_SIZE,
  prompt: "",
  promptSize: FOLLOW_INTERFACE,
  mono: "",
  codeSize: 12,
  terminal: "",
  terminalSize: 12,
  smoothing: true,
  wrap: false,
  advanced: false,
};

const range = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => from + i);
/** What Settings offers; settings.json may hold any size within `limits`. */
export const sizes = {
  interfaceSize: range(11, 16),
  promptSize: [FOLLOW_INTERFACE, ...range(11, 18)],
  codeSize: range(10, 18),
  terminalSize: range(9, 20),
};
const limits = {
  interfaceSize: [9, 22],
  promptSize: [8, 32],
  codeSize: [8, 32],
  terminalSize: [8, 32],
} satisfies Record<keyof typeof sizes, [number, number]>;

type Saved = Omit<Typography, "advanced">;

/** Each setting's name in settings.json, where people read and type it. */
const fileKeys = {
  sans: "interfaceFont",
  interfaceSize: "interfaceSize",
  prompt: "promptFont",
  promptSize: "promptSize",
  mono: "codeFont",
  codeSize: "codeSize",
  terminal: "terminalFont",
  terminalSize: "terminalSize",
  smoothing: "fontSmoothing",
  wrap: "wrapCode",
} as const satisfies Record<keyof Saved, string>;

const families = ["sans", "prompt", "mono", "terminal"] as const;
const flags = ["smoothing", "wrap"] as const;

/** `saved`'s value for `key` if it reads as one; undefined otherwise. */
function read(key: keyof Saved, value: unknown) {
  if ((families as readonly string[]).includes(key))
    return typeof value === "string" ? value.trim().slice(0, 100) : undefined;
  if ((flags as readonly string[]).includes(key))
    return typeof value === "boolean" ? value : undefined;
  const [min, max] = limits[key as keyof typeof limits];
  return typeof value === "number" &&
    ((key === "promptSize" && value === FOLLOW_INTERFACE) ||
      (value >= min && value <= max))
    ? value
    : undefined;
}

/** Each setting under `name`, or its default where it's missing or doesn't read. */
function fill(saved: unknown, name: (key: keyof Saved) => string): Saved {
  const section =
    saved && typeof saved === "object"
      ? (saved as Record<string, unknown>)
      : {};
  const value = {} as Record<keyof Saved, unknown>;
  for (const key of Object.keys(fileKeys) as (keyof Saved)[])
    value[key] = read(key, section[name(key)]) ?? defaultTypography[key];
  return value as Saved;
}

function serialize(value: Saved) {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(fileKeys) as (keyof Saved)[])
    if (value[key] !== defaultTypography[key]) out[fileKeys[key]] = value[key];
  return out;
}

/** What earlier builds kept in localStorage, the advanced switch with it. */
function parseLegacy(raw: string): Typography {
  const saved = JSON.parse(raw) as Record<string, unknown>;
  return { ...fill(saved, (key) => key), advanced: saved.advanced === true };
}

const ADVANCED_KEY = "relay-typography-advanced";
const LEGACY_KEY = "relay-typography";
const legacy = storedBefore(LEGACY_KEY, parseLegacy);
// The switch only shows rows; it stays with this window's state, not the file.
const advanced = persistedStore(
  ADVANCED_KEY,
  (saved) => saved === "1",
  (on) => (on ? "1" : null),
);
const before = legacy.read();
if (before?.advanced) advanced.set(true);

const store = fileSetting<Saved>({
  path: ["typography"],
  parse: (saved) => fill(saved, (key) => fileKeys[key]),
  serialize,
  legacy,
});

/** `family` quoted for CSS, ahead of `fallback`. */
export function fontStack(family: string, fallback: string) {
  if (!family) return fallback;
  return `"${family.replace(/["\\]/g, "")}", ${fallback}`;
}

const interfaceScale = (t: Saved) => t.interfaceSize / BASE_SIZE;

/** `size` pixels as they have to be written inside the zoomed window. */
const unzoomed = (t: Saved, size: number) =>
  +(size / interfaceScale(t)).toFixed(3);

/** The terminal's family and size, which xterm takes as options. */
export function terminalFont(t: Saved) {
  return {
    family: fontStack(t.terminal, fontStack(t.mono, DEFAULT_MONO)),
    size: unzoomed(t, t.terminalSize),
  };
}

let appliedScale: number | undefined;

function apply() {
  const value = store.get();
  const root = document.documentElement.style;
  const sans = fontStack(value.sans, DEFAULT_SANS);
  const px = (size: number) => `${unzoomed(value, size)}px`;
  root.setProperty("--font-sans", sans);
  root.setProperty("--font-mono", fontStack(value.mono, DEFAULT_MONO));
  root.setProperty("--font-prompt", fontStack(value.prompt, sans));
  root.setProperty("--font-terminal", terminalFont(value).family);
  root.setProperty(
    "--prompt-font-size",
    value.promptSize === FOLLOW_INTERFACE
      ? `${BASE_SIZE}px`
      : px(value.promptSize),
  );
  root.setProperty("--code-font-size", px(value.codeSize));
  root.setProperty("--terminal-font-size", px(value.terminalSize));
  root.setProperty(
    "-webkit-font-smoothing",
    value.smoothing ? "antialiased" : "auto",
  );
  document.documentElement.toggleAttribute("data-wrap", value.wrap);
  const scale = interfaceScale(value);
  if (scale !== appliedScale) {
    appliedScale = scale;
    void window.relay?.setInterfaceScale?.(scale).catch(() => {});
  }
}

store.subscribe(apply);

export function initTypography() {
  apply();
}

export function setTypography({
  advanced: showAdvanced,
  ...patch
}: Partial<Typography>) {
  if (showAdvanced !== undefined) advanced.set(showAdvanced);
  if (Object.keys(patch).length) store.set({ ...store.get(), ...patch });
}

export function useTypography(): Typography {
  return { ...store.use(), advanced: advanced.use() };
}
