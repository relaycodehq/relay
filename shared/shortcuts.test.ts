import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  accelerator,
  command,
  menuAcceleratorsSchema,
  menuShortcutIds,
  overlaps,
  recordCombo,
  reservedCombos,
  shortcutIds,
  type KeyCombo,
} from "./shortcuts";

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

describe("default shortcuts", () => {
  for (const mac of [true, false]) {
    const platform = mac ? "macOS" : "Linux and Windows";
    const all = shortcutIds.flatMap((id) =>
      command(id)
        .defaults(mac)
        .map((c) => ({ id, c })),
    );
    it(`never share keys on ${platform}`, () => {
      const clashes = all.flatMap((a, i) =>
        all
          .slice(i + 1)
          .filter(
            (b) =>
              a.id !== b.id &&
              overlaps(a.c, command(a.id).digits, b.c, command(b.id).digits),
          )
          .map((b) => `${a.id} and ${b.id}`),
      );
      expect(clashes).toEqual([]);
    });
    it(`leave the menu's and the OS's keys alone on ${platform}`, () => {
      const taken = all.filter(({ id, c }) =>
        reservedCombos(mac, command(id).outsideFields).some(([r]) =>
          overlaps(r, false, c, command(id).digits),
        ),
      );
      expect(taken.map(({ id }) => id)).toEqual([]);
    });
    it(`could each be recorded again on ${platform}`, () => {
      const refused = all.filter(
        ({ id, c }) =>
          !c.twice &&
          recordCombo(
            key(c.code, {
              alt: c.alt,
              ctrl: c.ctrl,
              meta: c.meta,
              shift: c.shift,
            }),
            id,
            mac,
          ).kind !== "combo",
      );
      expect(refused.map(({ id }) => id)).toEqual([]);
    });
    it(`give the menu accelerators it accepts on ${platform}`, () => {
      const menu = Object.fromEntries(
        menuShortcutIds.map((id) => [
          id,
          command(id)
            .defaults(mac)
            .map((c) => accelerator(c, mac)),
        ]),
      );
      expect(() => menuAcceleratorsSchema.parse(menu)).not.toThrow();
    });
  }
});

describe("recordCombo", () => {
  it("waits while only modifiers are down", () => {
    expect(
      recordCombo(key("MetaLeft", { meta: true }), "settle", true),
    ).toEqual({ kind: "wait" });
  });
  it("wants a modifier unless the command listens outside text fields", () => {
    expect(recordCombo(key("KeyE"), "settle", true).kind).toBe("invalid");
    expect(recordCombo(key("KeyE", { shift: true }), "settle", true).kind).toBe(
      "invalid",
    );
    expect(recordCombo(key("KeyE"), "review-next", true).kind).toBe("combo");
  });
  it("takes a function key alone", () => {
    expect(recordCombo(key("F5"), "settle", false)).toEqual({
      kind: "combo",
      combo: combo("F5"),
    });
  });
  it("keeps plain arrows and Space for moving around", () => {
    expect(recordCombo(key("ArrowDown"), "review-next", true).kind).toBe(
      "invalid",
    );
    expect(recordCombo(key("Space"), "review-next", true).kind).toBe("invalid");
  });
  it("leaves Enter, Tab and Esc to their usual jobs", () => {
    expect(recordCombo(key("Enter", { meta: true }), "settle", true).kind).toBe(
      "invalid",
    );
    expect(recordCombo(key("Tab", { ctrl: true }), "settle", false).kind).toBe(
      "invalid",
    );
  });
  it("lets a command that sends take Enter, with a modifier held", () => {
    expect(
      recordCombo(
        key("Enter", { meta: true, shift: true }),
        "send-new-thread",
        true,
      ).kind,
    ).toBe("combo");
    expect(
      recordCombo(key("Enter", { shift: true }), "send-new-thread", true).kind,
    ).toBe("invalid");
    expect(
      recordCombo(key("Tab", { meta: true }), "send-new-thread", true).kind,
    ).toBe("invalid");
  });
  it("records a digit family by its modifiers", () => {
    expect(
      recordCombo(
        key("Digit5", { ctrl: true, alt: true }),
        "jump-thread",
        true,
      ),
    ).toEqual({
      kind: "combo",
      combo: combo("Digit1", { ctrl: true, alt: true }),
    });
    expect(recordCombo(key("Digit5"), "jump-thread", true).kind).toBe(
      "invalid",
    );
    expect(
      recordCombo(key("KeyK", { meta: true }), "jump-thread", true).kind,
    ).toBe("invalid");
  });
});

describe("overlaps", () => {
  const cmd = combo("Digit1", { meta: true });
  it("lets a digit family cover 1 to 9 with the same modifiers", () => {
    expect(overlaps(cmd, true, combo("Digit7", { meta: true }), false)).toBe(
      true,
    );
    expect(overlaps(cmd, true, combo("Digit0", { meta: true }), false)).toBe(
      false,
    );
    expect(
      overlaps(cmd, true, combo("Digit7", { meta: true, alt: true }), false),
    ).toBe(false);
  });
  it("tells a double press from a single one", () => {
    expect(
      overlaps(combo("Escape", { twice: true }), false, combo("Escape"), false),
    ).toBe(false);
  });
});

describe("accelerator", () => {
  it("names ⇧= the way Electron's zoom in does", () => {
    expect(accelerator(combo("Equal", { meta: true, shift: true }), true)).toBe(
      "Command+Plus",
    );
  });
  it("uses each platform's modifier names", () => {
    expect(accelerator(combo("Backquote", { ctrl: true }), true)).toBe(
      "Control+`",
    );
    expect(accelerator(combo("KeyI", { ctrl: true, shift: true }), false)).toBe(
      "Ctrl+Shift+I",
    );
  });
  it("names a key by what the layout types on it", () => {
    // AZERTY: the key where QWERTY has Q types A.
    const azerty = (code: string) => (code === "KeyQ" ? "a" : undefined);
    expect(accelerator(combo("KeyQ", { meta: true }), true, azerty)).toBe(
      "Command+A",
    );
  });
  it("has nothing for a double press or an unnamed key", () => {
    expect(accelerator(combo("Escape", { twice: true }), true)).toBeUndefined();
    expect(
      accelerator(combo("LaunchMail", { meta: true }), true),
    ).toBeUndefined();
  });
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
  const load = () => import("../src/lib/shortcuts");

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
