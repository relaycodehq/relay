import { useSyncExternalStore } from "react";

/**
 * Fonts and sizes per surface: the interface, the prompt box, code and the
 * terminal. A per-device preference like the theme. A chosen family goes in
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
export const sizes = {
  interfaceSize: range(11, 16),
  promptSize: [FOLLOW_INTERFACE, ...range(11, 18)],
  codeSize: range(10, 18),
  terminalSize: range(9, 20),
};

const STORAGE_KEY = "relay-typography";
const listeners = new Set<() => void>();
let value = read();

function read(): Typography {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    const family = (v: unknown) =>
      typeof v === "string" ? v.trim().slice(0, 100) : "";
    const size = (key: keyof typeof sizes) =>
      sizes[key].includes(saved[key]) ? saved[key] : defaultTypography[key];
    // Before it could follow the interface, 13 was the default that got saved
    // along with every other change; keeping it pinned would leave the prompt
    // behind whenever the interface size moves.
    const promptSize =
      saved.promptSize === 13 ? FOLLOW_INTERFACE : size("promptSize");
    const flag = (key: "smoothing" | "wrap" | "advanced") =>
      typeof saved[key] === "boolean" ? saved[key] : defaultTypography[key];
    return {
      sans: family(saved.sans),
      interfaceSize: size("interfaceSize"),
      prompt: family(saved.prompt),
      promptSize,
      mono: family(saved.mono),
      codeSize: size("codeSize"),
      terminal: family(saved.terminal),
      terminalSize: size("terminalSize"),
      smoothing: flag("smoothing"),
      wrap: flag("wrap"),
      advanced: flag("advanced"),
    };
  } catch {
    return defaultTypography;
  }
}

/** `family` quoted for CSS, ahead of `fallback`. */
export function fontStack(family: string, fallback: string) {
  if (!family) return fallback;
  return `"${family.replace(/["\\]/g, "")}", ${fallback}`;
}

export const interfaceScale = (t: Typography) => t.interfaceSize / BASE_SIZE;

/** `size` pixels as they have to be written inside the zoomed window. */
const unzoomed = (t: Typography, size: number) =>
  +(size / interfaceScale(t)).toFixed(3);

/** The terminal's family and size, which xterm takes as options. */
export function terminalFont(t: Typography) {
  return {
    family: fontStack(t.terminal, fontStack(t.mono, DEFAULT_MONO)),
    size: unzoomed(t, t.terminalSize),
  };
}

let appliedScale: number | undefined;

function apply() {
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

export function initTypography() {
  apply();
}

export function setTypography(patch: Partial<Typography>) {
  value = { ...value, ...patch };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Still applies for this session.
  }
  apply();
  for (const listener of listeners) listener();
}

export const useTypography = () =>
  useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => value,
  );
