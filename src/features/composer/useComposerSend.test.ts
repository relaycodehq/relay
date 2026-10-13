import { expect, it, vi } from "vitest";
import { harnessReact, mount } from "../../../tests/unit/hook-harness";
import type { SendSettings } from "../../../shared/compose-send";
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
