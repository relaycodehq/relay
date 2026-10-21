// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
import type { KeyboardEvent } from "react";
import type { KeyCombo } from "../../../shared/shortcuts";
import { resetAllBindings, setBindings } from "../../lib/shortcuts";
import { composerKeys } from "./composer-keys";

const key = (code = "Enter", mods: Partial<KeyCombo> = {}, repeat = false) =>
  ({
    key: code,
    code,
    ctrlKey: !!mods.ctrl,
    metaKey: !!mods.meta,
    altKey: !!mods.alt,
    shiftKey: !!mods.shift,
    repeat,
    nativeEvent: { isComposing: false },
    preventDefault: vi.fn(),
  }) as unknown as KeyboardEvent<HTMLElement>;

const combo = (code: string, mods: Partial<KeyCombo> = {}): KeyCombo => ({
  code,
  ctrl: false,
  meta: false,
  alt: false,
  shift: false,
  ...mods,
});

beforeEach(() => {
  resetAllBindings();
  setBindings("send-new-thread", [combo("Enter", { ctrl: true, alt: true })]);
  setBindings("edit-queued", [combo("ArrowUp", { alt: true })]);
  setBindings("effort-up", [combo("ArrowRight", { ctrl: true })]);
  setBindings("quick-next", [combo("ArrowRight", { ctrl: true, shift: true })]);
});

function context() {
  return {
    recall: vi.fn(() => false),
    menus: [vi.fn(() => false), vi.fn(() => false), vi.fn(() => false)],
    editQueued: vi.fn(() => true),
    alternateCompact: false,
    sendKey: "enter" as const,
    runningAction: "queue" as const,
    send: vi.fn(async () => {}),
    nextThread: vi.fn(),
    stepEffort: vi.fn(),
    stepQuick: vi.fn(),
  };
}

it("gives recall first refusal, then each menu, before sending", () => {
  const c = context();
  c.recall.mockReturnValueOnce(true);
  composerKeys(key(), c);
  expect(c.menus[0]).not.toHaveBeenCalled();
  expect(c.send).not.toHaveBeenCalled();

  c.menus[1]!.mockReturnValueOnce(true);
  composerKeys(key(), c);
  expect(c.menus[0]).toHaveBeenCalledOnce();
  expect(c.menus[1]).toHaveBeenCalledOnce();
  expect(c.menus[2]).not.toHaveBeenCalled();
  expect(c.send).not.toHaveBeenCalled();
});

it("leaves composing input to the editor without sending or taking a queued message", () => {
  const c = context();
  const event = key("ArrowUp", { alt: true });
  Object.assign(event.nativeEvent, { isComposing: true });
  composerKeys(event, c);
  expect(c.editQueued).not.toHaveBeenCalled();
  expect(c.send).not.toHaveBeenCalled();
  expect(event.preventDefault).not.toHaveBeenCalled();
});

it("takes a queued message only on the first keypress when the caret allows it", () => {
  const c = context();
  const event = key("ArrowUp", { alt: true });
  composerKeys(event, c);
  expect(c.editQueued).toHaveBeenCalledOnce();
  expect(event.preventDefault).toHaveBeenCalledOnce();
  composerKeys(key("ArrowUp", { alt: true }, true), c);
  expect(c.editQueued).toHaveBeenCalledOnce();

  c.editQueued.mockReturnValueOnce(false);
  const refused = key("ArrowUp", { alt: true });
  composerKeys(refused, c);
  expect(refused.preventDefault).not.toHaveBeenCalled();
});

it("prioritizes alternate compaction over send-then-new-thread when both keys match", () => {
  const c = context();
  const event = key("Enter", { ctrl: true, alt: true });
  composerKeys(event, { ...c, sendKey: "mod-enter", alternateCompact: true });
  expect(c.send).toHaveBeenCalledExactlyOnceWith({ flipCompact: true });
  expect(c.nextThread).not.toHaveBeenCalled();
});

it("passes the next-thread action to the send, respects steer, and ignores held keys", () => {
  const c = context();
  const event = key("Enter", { ctrl: true, alt: true });
  composerKeys(event, { ...c, runningAction: "steer" });
  expect(c.send).toHaveBeenCalledExactlyOnceWith({
    steer: true,
    after: c.nextThread,
  });
  expect(c.nextThread).not.toHaveBeenCalled();
  composerKeys(key("Enter", { ctrl: true, alt: true }, true), c);
  expect(c.send).toHaveBeenCalledOnce();
});

it("steps effort and enabled quick presets without sending", () => {
  const c = context();
  composerKeys(key("ArrowRight", { ctrl: true }), c);
  expect(c.stepEffort).toHaveBeenCalledExactlyOnceWith(1);
  composerKeys(key("ArrowRight", { ctrl: true, shift: true }), c);
  expect(c.stepQuick).toHaveBeenCalledExactlyOnceWith(1);
  expect(c.send).not.toHaveBeenCalled();

  const event = key("ArrowRight", { ctrl: true, shift: true });
  composerKeys(event, { ...c, stepQuick: undefined });
  expect(event.preventDefault).not.toHaveBeenCalled();
});

it("uses the running send preference and its alternate without swallowing newlines", () => {
  const c = context();
  composerKeys(key(), { ...c, runningAction: "steer" });
  composerKeys(key("Enter", { ctrl: true }), { ...c, runningAction: "steer" });
  expect(c.send.mock.calls).toEqual([[{ steer: true }], [{ steer: false }]]);
  const newline = key("Enter", { shift: true });
  composerKeys(newline, c);
  expect(newline.preventDefault).not.toHaveBeenCalled();
  expect(c.send).toHaveBeenCalledTimes(2);
});
