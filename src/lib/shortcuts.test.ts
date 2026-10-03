import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { KeyCombo } from "../../shared/shortcuts";

const key = (
  code: string,
  mods: { alt?: boolean; ctrl?: boolean; meta?: boolean; shift?: boolean } = {},
) => ({
  code,
  altKey: !!mods.alt,
  ctrlKey: !!mods.ctrl,
  metaKey: !!mods.meta,
  shiftKey: !!mods.shift,
});
const combo = (code: string, mods: Partial<KeyCombo> = {}): KeyCombo => ({
  code,
  alt: false,
  ctrl: false,
  meta: false,
  shift: false,
  ...mods,
});

describe("saved shortcuts", () => {
  const saved = new Map<string, string>();
  beforeEach(() => {
    saved.clear();
    vi.resetModules();
    vi.stubGlobal("navigator", { platform: "MacIntel" });
    vi.stubGlobal("window", {});
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => saved.get(k) ?? null,
      setItem: (k: string, v: string) => saved.set(k, v),
      removeItem: (k: string) => saved.delete(k),
    });
  });
  afterEach(() => vi.unstubAllGlobals());
  const load = () => import("./shortcuts");

  it("brings over the dictation key from before", async () => {
    saved.set(
      "relay-dictation-shortcut",
      JSON.stringify(combo("KeyD", { ctrl: true, alt: true })),
    );
    const s = await load();
    expect(s.shortcutLabel("dictate")).toBe("⌃⌥D");
    s.setBindings("settle", [combo("KeyE", { meta: true, shift: true })]);
    expect(saved.has("relay-dictation-shortcut")).toBe(false);
    expect(JSON.parse(saved.get("relay-shortcuts")!).dictate).toHaveLength(1);
  });

  it("drops what it can't read and keeps the rest", async () => {
    saved.set(
      "relay-shortcuts",
      JSON.stringify({
        settle: [combo("KeyY", { meta: true })],
        sidebar: [{ code: 5 }],
        gone: [combo("KeyG", { meta: true })],
      }),
    );
    const s = await load();
    expect(s.shortcutLabel("settle")).toBe("⌘Y");
    expect(s.shortcutLabel("sidebar")).toBe("⌘B");
  });

  it("reports a clash and moves the keys when asked", async () => {
    const s = await load();
    const cmdB = combo("KeyB", { meta: true });
    expect(s.conflictOf("settle", cmdB)).toEqual({
      kind: "command",
      id: "sidebar",
    });
    s.reassign("settle", [cmdB], cmdB);
    expect(s.shortcutLabel("settle")).toBe("⌘B");
    expect(s.bindings("sidebar")).toEqual([]);
    expect(s.isCustomized("sidebar")).toBe(true);
  });

  it("refuses the keys the menu keeps", async () => {
    const s = await load();
    expect(s.conflictOf("settle", combo("KeyQ", { meta: true }))).toEqual({
      kind: "reserved",
      what: "quits Relay",
    });
  });

  it("forgets a change set back to the default", async () => {
    const s = await load();
    s.setBindings("settle", [combo("KeyY", { meta: true })]);
    expect(s.isCustomized("settle")).toBe(true);
    s.setBindings("settle", s.defaultBindings("settle"));
    expect(s.isCustomized("settle")).toBe(false);
    expect(saved.has("relay-shortcuts")).toBe(false);
  });

  it("matches nothing while a new shortcut is being recorded", async () => {
    const s = await load();
    const cmdE = key("KeyE", { meta: true });
    expect(s.matches("settle", cmdE)).toBe(true);
    s.setRecording(true);
    expect(s.matches("settle", cmdE)).toBe(false);
    s.setRecording(false);
    expect(s.matches("settle", cmdE)).toBe(true);
  });

  it("labels a digit family and a double press", async () => {
    const s = await load();
    expect(s.shortcutLabel("jump-thread")).toBe("⌘1–9");
    expect(s.shortcutLabel("stop")).toBe("Esc Esc");
    expect(s.shortcutLabel("zoom-in")).toBe("⌘+");
    expect(s.digitOf("jump-thread", key("Digit4", { meta: true }))).toBe(4);
    expect(s.digitOf("jump-thread", key("Digit4", { ctrl: true }))).toBe(
      undefined,
    );
  });
});
