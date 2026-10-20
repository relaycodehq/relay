import { expect, it, vi } from "vitest";
import { harnessReact, mount } from "../../../tests/unit/hook-harness";
import type { SendSettings } from "../../../shared/compose-send";
import type { Recipient } from "../../../shared/recipient";
import { useComposerSend } from "./useComposerSend";

vi.mock("react", () => harnessReact);
vi.mock("../dictation/audio/session", () => ({
  dictationSnapshot: () => ({ phase: "idle" }),
  stopDictation: async () => true,
}));

it("preserves Send later when the draft starts with /btw", async () => {
  const onSend = vi.fn(async () => true);
  const sendAt = Date.now() + 86_400_000;
  const settings: SendSettings = {
    to: "codex",
    choice: { model: "", reasoningEffort: "", fast: false },
    runtimeMode: "full-access",
    interactionMode: "default",
  };
  const outgoing = { dispatch: vi.fn(), restore: vi.fn(), forget: vi.fn() };
  const after = vi.fn();
  const sending = mount(() =>
    useComposerSend({
      draft: {
        text: "/btw Does this support caching?",
        attached: [],
        images: [],
        preparing: false,
        isPreparing: () => false,
        take: () => outgoing,
      } as never,
      state: {} as never,
      runs: { codex: true, sendSettings: () => settings } as never,
      to: "codex",
      conversation: { busy: false, running: false },
      complete: false,
      intercept: () => false,
      onSend,
    }),
  );
  await sending().send(false, sendAt, after);
  expect(onSend).toHaveBeenCalledOnce();
  expect(onSend).toHaveBeenCalledWith(
    expect.objectContaining({
      body: "@codex Does this support caching?",
      side: true,
      sendAt,
    }),
    outgoing.dispatch,
  );
  expect(after).toHaveBeenCalledOnce();
});

it("sends a meme's line once while the first send is on its way", async () => {
  let accept!: (sent: boolean) => void;
  const onSend = vi.fn(
    () => new Promise<boolean>((resolve) => (accept = resolve)),
  );
  const settings: SendSettings = {
    to: "codex",
    choice: { model: "", reasoningEffort: "", fast: false },
    runtimeMode: "full-access",
    interactionMode: "default",
  };
  const sending = mount(() =>
    useComposerSend({
      draft: { text: "/meme dew", attached: [], images: [] } as never,
      state: {} as never,
      runs: { codex: true, sendSettings: () => settings } as never,
      to: "codex",
      conversation: { busy: false, running: false },
      complete: false,
      intercept: () => false,
      onSend,
    }),
  );
  const first = sending().sendLine("[meme dew] …");
  // Enter held down, or the cell clicked twice.
  expect(await sending().sendLine("[meme dew] …")).toBe(false);
  accept(true);
  expect(await first).toBe(true);
  expect(onSend).toHaveBeenCalledOnce();
  // Once it's gone, the next one goes.
  const next = sending().sendLine("[meme dew] …");
  accept(true);
  expect(await next).toBe(true);
  expect(onSend).toHaveBeenCalledTimes(2);
});

it.each(["Read this", "/btw Read this"])(
  "blocks sending %s while a paste is saving, before rerender",
  async (text) => {
    const onSend = vi.fn();
    const take = vi.fn();
    const sending = mount(() =>
      useComposerSend({
        draft: {
          text,
          attached: [],
          images: [],
          preparing: false,
          isPreparing: () => true,
          take,
        } as never,
        state: {} as never,
        runs: { sendSettings: () => undefined } as never,
        to: "codex",
        conversation: { busy: false, running: false },
        complete: false,
        intercept: () => false,
        onSend,
      }),
    );
    await sending().send();
    expect(take).not.toHaveBeenCalled();
    expect(onSend).not.toHaveBeenCalled();
  },
);

it.each(["claude", "message"] as const)(
  "sends to %s without a Codex choice",
  async (to) => {
    const onSend = vi.fn(async (_value: unknown) => true);
    const choice = { model: "", reasoningEffort: "" as const, fast: false };
    const sending = mount(() =>
      useComposerSend({
        draft: {
          text: "Continue",
          attached: [],
          images: [],
          preparing: false,
          isPreparing: () => false,
          skills: () => [],
          take: () => ({
            dispatch: () => {},
            restore: () => {},
            forget: async () => {},
          }),
        } as never,
        state: {
          saveLastModel: vi.fn(),
          setProvider: vi.fn(),
          setInteractionMode: vi.fn(),
        } as never,
        runs: {
          sendSettings: (recipient: Recipient) =>
            recipient === "codex"
              ? undefined
              : {
                  to: recipient,
                  choice,
                  runtimeMode: "full-access",
                  interactionMode: "default",
                },
          choiceFor: () => choice,
          contextFor: () => ({}),
        } as never,
        to,
        conversation: { busy: false, running: false },
        complete: false,
        intercept: () => false,
        onSend,
      }),
    );
    expect(sending().disabled).toBe(false);
    await sending().send();
    expect(onSend.mock.calls[0][0]).toMatchObject({ to });
    await sending().implementPlan("claude");
    await sending().sendGoal("claude", "pause");
    expect(await sending().sendLine("Another line")).toBe(true);
    expect(onSend).toHaveBeenCalledTimes(4);
  },
);
