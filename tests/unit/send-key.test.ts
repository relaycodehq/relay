import { describe, expect, it } from "vitest";
import type { KeyboardEvent } from "react";
import { sendAction, type SendKey } from "../../src/lib/send-key";

const key = (mods: { meta?: boolean; shift?: boolean; alt?: boolean } = {}) =>
  ({
    key: "Enter",
    keyCode: 13,
    metaKey: !!mods.meta,
    ctrlKey: false,
    shiftKey: !!mods.shift,
    altKey: !!mods.alt,
    nativeEvent: { isComposing: false },
  }) as unknown as KeyboardEvent;

describe("sendAction", () => {
  const cases: [SendKey, Parameters<typeof key>[0], string | null][] = [
    ["enter", {}, "send"],
    ["enter", { shift: true }, null],
    ["enter", { meta: true }, "steer"],
    ["shift-enter", {}, null],
    ["shift-enter", { shift: true }, "send"],
    ["shift-enter", { meta: true }, "steer"],
    ["mod-enter", {}, null],
    ["mod-enter", { shift: true }, null],
    ["mod-enter", { meta: true }, "send"],
    ["mod-enter", { meta: true, shift: true }, "steer"],
    ["enter", { alt: true }, null],
  ];
  it.each(cases)("%s with %o → %s", (sendKey, mods, expected) => {
    expect(sendAction(key(mods), sendKey)).toBe(expected);
  });
  it("ignores Enter while an IME is composing", () => {
    const e = key();
    (e.nativeEvent as { isComposing: boolean }).isComposing = true;
    expect(sendAction(e, "enter")).toBeNull();
  });
});
