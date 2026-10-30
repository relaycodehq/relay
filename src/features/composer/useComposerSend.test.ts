// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
import { flush, mount } from "../../../tests/unit/hook-harness";
import type { SendSettings } from "../../../shared/compose-send";
import type { Recipient } from "../../../shared/recipient";
import { useComposerSend } from "./useComposerSend";

const dictation = vi.hoisted(() => ({
  snapshot: vi.fn<() => { phase: string; owner?: object }>(() => ({
    phase: "idle",
  })),
  stop: vi.fn(async () => true),
}));

vi.mock("../dictation/audio/session", () => ({
  dictationSnapshot: dictation.snapshot,
  stopDictation: dictation.stop,
}));

beforeEach(() => {
  dictation.snapshot.mockReset().mockReturnValue({ phase: "idle" });
  dictation.stop.mockReset().mockResolvedValue(true);
});

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
  await sending().send({ sendAt, after });
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

it("sends the draft's screenshot with a /btw", async () => {
  const onSend = vi.fn(async (_value: unknown) => true);
  const settings: SendSettings = {
    to: "claude",
    choice: { model: "", reasoningEffort: "", fast: false },
    runtimeMode: "full-access",
    interactionMode: "default",
  };
  const outgoing = { dispatch: vi.fn(), restore: vi.fn(), forget: vi.fn() };
  const take = vi.fn(() => outgoing);
  const screenshot = {
    id: "shot",
    name: "screen.png",
    mimeType: "image/png",
    dataUrl: "data:image/png;base64,AAAA",
  };
  const sending = mount(() =>
    useComposerSend({
      draft: {
        text: "/btw What's on this screen?",
        attached: [screenshot],
        images: [screenshot],
        preparing: false,
        isPreparing: () => false,
        take,
      } as never,
      state: {} as never,
      runs: { claude: true, sendSettings: () => settings } as never,
      to: "claude",
      conversation: { busy: false, running: true },
      complete: false,
      intercept: () => false,
      onSend,
    }),
  );
  await sending().send();
  expect(take).toHaveBeenCalledWith(true);
  expect(onSend.mock.calls[0]![0]).toMatchObject({
    side: true,
    images: [{ name: "screen.png", mimeType: "image/png" }],
  });
  expect(outgoing.forget).toHaveBeenCalledOnce();
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

function messageSender(
  onSend: (value: unknown, dispatch?: () => void) => Promise<boolean>,
) {
  const choice = { model: "", reasoningEffort: "" as const, fast: false };
  const outgoing = {
    dispatch: vi.fn(),
    restore: vi.fn(),
    forget: vi.fn(async () => {}),
  };
  const sending = mount(() =>
    useComposerSend({
      draft: {
        text: "Continue",
        attached: [],
        images: [],
        preparing: false,
        isPreparing: () => false,
        skills: () => [],
        take: () => outgoing,
      } as never,
      state: { saveLastModel: vi.fn() } as never,
      runs: {
        sendSettings: () => ({
          to: "codex",
          choice,
          runtimeMode: "full-access",
          interactionMode: "default",
        }),
        choiceFor: () => choice,
        contextFor: () => ({}),
      } as never,
      to: "codex",
      conversation: { busy: false, running: true },
      complete: false,
      intercept: () => false,
      onSend,
    }),
  );
  return { sending, outgoing };
}

it.each([true, false])(
  "preserves the compact override %s and runs after only on acceptance",
  async (accepted) => {
    const onSend = vi.fn(async () => accepted);
    const after = vi.fn();
    const { sending, outgoing } = messageSender(onSend);
    await sending().send({ steer: true, compact: accepted, after });
    expect(onSend).toHaveBeenCalledWith(
      expect.objectContaining({ delivery: "steer", compact: accepted }),
      outgoing.dispatch,
    );
    expect(after).toHaveBeenCalledTimes(accepted ? 1 : 0);
    expect(outgoing.restore).toHaveBeenCalledTimes(accepted ? 0 : 1);
    expect(outgoing.forget).toHaveBeenCalledTimes(accepted ? 1 : 0);
  },
);

it("retains scheduling, compaction and the completion callback while dictation finishes", async () => {
  const onSend = vi.fn(async () => true);
  const after = vi.fn();
  const { sending, outgoing } = messageSender(onSend);
  let finish!: (finished: boolean) => void;
  dictation.stop.mockImplementationOnce(
    () => new Promise((resolve) => (finish = resolve)),
  );
  dictation.snapshot.mockReturnValue({
    phase: "recording",
    owner: sending().dictation,
  });
  const sendAt = Date.now() + 60_000;
  await sending().send({ sendAt, compact: false, after });
  expect(onSend).not.toHaveBeenCalled();
  dictation.snapshot.mockReturnValue({ phase: "idle" });
  finish(true);
  await flush();
  expect(onSend).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ sendAt, compact: false }),
    outgoing.dispatch,
  );
  expect(after).toHaveBeenCalledOnce();
});
