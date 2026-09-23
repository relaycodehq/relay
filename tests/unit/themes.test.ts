import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadAppearance,
  luminance,
  normalizeHex,
  resolveAppearance,
  resolvePalette,
  themeById,
} from "../../src/lib/themes";

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
  });
});
afterEach(() => vi.unstubAllGlobals());

const saved = (value: unknown) =>
  store.set("relay-appearance", JSON.stringify(value));

describe("resolvePalette", () => {
  it("leaves a theme untouched without overrides", () => {
    const relay = themeById("relay");
    expect(resolvePalette("dark", { theme: "relay" })).toBe(relay.dark);
    expect(resolvePalette("light", { theme: "relay", contrast: 50 })).toBe(
      relay.light,
    );
  });

  it("carries the theme's structure onto a new background", () => {
    const palette = resolvePalette("dark", {
      theme: "relay",
      background: "#000000",
    });
    const relay = themeById("relay").dark!;
    expect(palette.surface).toBe("#000000");
    expect(palette.text).toBe(relay.text);
    // The sidebar still sits a little towards the text, now from black.
    expect(luminance(palette.sidebar)).toBeGreaterThan(0);
    expect(luminance(palette.sidebar)).toBeLessThan(luminance(relay.sidebar));
    expect(palette.syntax).toBe(relay.syntax);
  });

  it("spreads surfaces apart as contrast rises", () => {
    const distance = (contrast: number) => {
      const p = resolvePalette("light", { theme: "relay", contrast });
      return luminance(p.surface) - luminance(p.border);
    };
    expect(distance(0)).toBeLessThan(distance(50));
    expect(distance(50)).toBeLessThan(distance(100));
  });

  it("keeps secondary text readable at the lowest contrast", () => {
    const p = resolvePalette("dark", { theme: "relay", contrast: 0 });
    expect(luminance(p.muted)).toBeGreaterThan(luminance(p.border));
  });
});

describe("loadAppearance", () => {
  it("defaults to Relay following the system", () => {
    expect(loadAppearance()).toEqual({
      mode: "system",
      light: { theme: "relay" },
      dark: { theme: "relay" },
    });
  });

  it("moves a dark-only theme from the old format into the dark slot", () => {
    saved({ theme: "dracula", mode: "system", accent: "#ff79c6" });
    expect(loadAppearance()).toEqual({
      mode: "dark",
      light: { theme: "relay" },
      dark: { theme: "dracula", accent: "#ff79c6" },
    });
  });

  it("gives an old two-mode theme's accent to both modes", () => {
    saved({ theme: "relay", mode: "light", accent: "#123456" });
    expect(loadAppearance()).toEqual({
      mode: "light",
      light: { theme: "relay", accent: "#123456" },
      dark: { theme: "relay", accent: "#123456" },
    });
  });

  it("drops values that don't fit", () => {
    saved({
      mode: "dark",
      light: { theme: "solarized-light", foreground: "#3c4c53", contrast: 70 },
      dark: { theme: "catppuccin-latte", background: "red", contrast: 140 },
    });
    expect(loadAppearance()).toEqual({
      mode: "dark",
      light: { theme: "solarized-light", foreground: "#3c4c53", contrast: 70 },
      dark: { theme: "relay" },
    });
  });
});

describe("resolveAppearance", () => {
  it("shows the system's mode when following it", () => {
    const value = {
      mode: "system" as const,
      light: { theme: "solarized-light" },
      dark: { theme: "nord", accent: "#b48ead" },
    };
    expect(resolveAppearance(value, false).palette.syntax).toBe(
      "solarized-light",
    );
    const dark = resolveAppearance(value, true);
    expect(dark.theme.id).toBe("nord");
    expect(dark.accent).toBe("#b48ead");
  });
});

describe("normalizeHex", () => {
  it("accepts short and long codes with or without #", () => {
    expect(normalizeHex("#ABC")).toBe("#aabbcc");
    expect(normalizeHex("1a1c1f")).toBe("#1a1c1f");
    expect(normalizeHex(" #FFFFFF ")).toBe("#ffffff");
    expect(normalizeHex("#12345")).toBeNull();
    expect(normalizeHex("blue")).toBeNull();
  });
});
