import { describe, expect, it } from "vitest";
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
