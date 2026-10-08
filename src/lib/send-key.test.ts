import { describe, expect, it } from "vitest";
import type { KeyboardEvent } from "react";
import {
  queueKeyLabel,
  sendAction,
  sendsMessage,
  steerKeyLabel,
  type RunningSendAction,
  type SendKey,
} from "./send-key";
import { mac } from "./mod-key";

const key = (
  mods: { meta?: boolean; ctrl?: boolean; shift?: boolean; alt?: boolean } = {},
) =>
  ({
    key: "Enter",
    keyCode: 13,
    metaKey: !!mods.meta,
    ctrlKey: !!mods.ctrl,
    shiftKey: !!mods.shift,
    altKey: !!mods.alt,
    nativeEvent: { isComposing: false },
  }) as unknown as KeyboardEvent;

describe("sendAction", () => {
  const cases: [SendKey, Parameters<typeof key>[0], string | null][] = [
    ["enter", {}, "send"],
    ["enter", { shift: true }, null],
    ["enter", { meta: true }, "steer"],
    ["enter", { ctrl: true }, "steer"],
    ["enter", { meta: true, shift: true }, "steer"],
    ["shift-enter", {}, null],
    ["shift-enter", { shift: true }, "send"],
    ["shift-enter", { meta: true }, "steer"],
    ["shift-enter", { ctrl: true }, "steer"],
    ["mod-enter", {}, null],
    ["mod-enter", { shift: true }, null],
    ["mod-enter", { meta: true }, "send"],
    ["mod-enter", { meta: true, shift: true }, "steer"],
    ["mod-enter", { ctrl: true }, "send"],
    ["mod-enter", { ctrl: true, shift: true }, "steer"],
    ["enter", { alt: true }, null],
    ["enter", { alt: true, meta: true }, null],
    ["shift-enter", { alt: true, shift: true }, null],
    ["mod-enter", { alt: true, ctrl: true }, null],
  ];
  describe.each<RunningSendAction>(["queue", "steer"])(
    "%s by default",
    (action) => {
      it.each(cases)("%s with %o", (sendKey, mods, expected) => {
        const result =
          expected === null || action === "queue"
            ? expected
            : expected === "send"
              ? "steer"
              : "send";
        expect(sendAction(key(mods), sendKey, action)).toBe(result);
      });
      it("ignores Enter while an IME is composing", () => {
        const e = key();
        (e.nativeEvent as { isComposing: boolean }).isComposing = true;
        expect(sendAction(e, "enter", action)).toBeNull();
      });
      it("ignores the legacy IME key code and non-Enter keys", () => {
        expect(
          sendAction({ ...key(), keyCode: 229 }, "enter", action),
        ).toBeNull();
        expect(sendAction({ ...key(), key: "a" }, "enter", action)).toBeNull();
      });
    },
  );

  it("keeps composers without an active answer using either send shortcut", () => {
    expect(sendsMessage(key(), "enter")).toBe(true);
    expect(sendsMessage(key({ shift: true }), "enter")).toBe(false);
    expect(sendsMessage(key({ meta: true }), "enter")).toBe(true);
  });
});

describe("running-action shortcut hints", () => {
  const mod = mac ? "⌘" : "Ctrl+";
  const shift = mac ? "⇧" : "Shift+";
  const enter = mac ? "↵" : "Enter";
  it.each<[SendKey, string, string]>([
    ["enter", enter, mod + enter],
    ["shift-enter", shift + enter, mod + enter],
    ["mod-enter", mod + enter, mod + shift + enter],
  ])("%s shows the shortcut for each action", (sendKey, primary, alternate) => {
    expect(queueKeyLabel(sendKey, "queue")).toBe(primary);
    expect(steerKeyLabel(sendKey, "queue")).toBe(alternate);
    expect(queueKeyLabel(sendKey, "steer")).toBe(alternate);
    expect(steerKeyLabel(sendKey, "steer")).toBe(primary);
  });
});
