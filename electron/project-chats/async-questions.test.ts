import { expect, it, vi } from "vitest";
import { defaultAISettings } from "../../shared/settings";
import type {
  ChatMessage,
  ProjectChat,
  ProjectChatSend,
} from "../../shared/projects";
import { AsyncQuestions } from "./async-questions";
import { ActiveTurns } from "./active";
import { threadControl } from "./control";
import type { ChatCore } from "./core";

function fixture() {
  const message: ChatMessage = {
    id: "message",
    role: "assistant",
    body: "",
    provider: "codex",
    status: "streaming",
    created: 1,
    version: 1,
    questions: [
      {
        id: "item",
        questions: [
          { id: "0", question: "Which?" },
          { id: "1", question: "Who?" },
        ],
      },
    ],
  };
  const input: ProjectChatSend = {
    id: "user",
    body: "Work",
    provider: "codex",
    to: "codex",
    choice: defaultAISettings.questions,
    runtimeMode: "approval-required",
    interactionMode: "default",
  };
  const chat = {
    id: "chat",
    messages: [message],
    lastInput: input,
  } as ProjectChat;
  const active = new ActiveTurns(() => {});
  const run = active.claim(chat.id, input);
  run.steer = vi.fn().mockResolvedValue(undefined);
  const save = vi.fn().mockResolvedValue(undefined);
  const emit = vi.fn();
  const core = {
    storage: { load: async () => chat, save },
    store: { aiSettings: () => defaultAISettings },
    active,
    control: threadControl(),
    closing: () => false,
    emit,
  } as unknown as ChatCore;
  const send = vi.fn().mockResolvedValue(undefined);
  return {
    questions: new AsyncQuestions(core, send),
    chat,
    message,
    run,
    save,
    emit,
    send,
  };
}
const answer = {
  kind: "question" as const,
  answers: { "0": ["Private"], "1": ["Owner"] },
};

it("rejects missing, partial, unknown and malformed answers without sending or consuming the question", async () => {
  const f = fixture();
  for (const value of [
    { kind: "question", answers: { "0": ["Private"] } },
    { kind: "question", answers: { ...answer.answers, extra: ["x"] } },
    { kind: "question", answers: { ...answer.answers, "1": [" "] } },
    { kind: "approval", decision: "accept" },
    { kind: "question", answers: { "0": [4], "1": ["Owner"] } },
  ]) {
    await expect(
      f.questions.answer("chat", "message", "item", value as never),
    ).rejects.toThrow();
  }
  await expect(
    f.questions.answer("chat", "missing", "item", answer),
  ).rejects.toThrow("no longer available");
  await expect(
    f.questions.answer("chat", "message", "missing", answer),
  ).rejects.toThrow("no longer available");
  expect(f.run.steer).not.toHaveBeenCalled();
  expect(f.send).not.toHaveBeenCalled();
  expect(f.message.questions![0].answers).toBeUndefined();
});

it("rolls back a refused steer and leaves the question answerable on retry", async () => {
  const f = fixture();
  vi.mocked(f.run.steer!).mockRejectedValueOnce(new Error("Turn ended"));
  await expect(
    f.questions.answer("chat", "message", "item", answer),
  ).rejects.toThrow("Turn ended");
  expect(f.chat.messages).toEqual([f.message]);
  expect(f.message.questions![0].answers).toBeUndefined();
  await f.questions.answer("chat", "message", "item", answer);
  expect(f.chat.messages).toHaveLength(2);
  expect(f.chat.messages[1]).toMatchObject({
    asyncQuestionAnswer: true,
    unread: true,
    status: "complete",
  });
  expect(f.message.questions![0].answers).toEqual(answer.answers);
});

it("serializes simultaneous replies so the question is answered once", async () => {
  const f = fixture();
  const results = await Promise.allSettled([
    f.questions.answer("chat", "message", "item", answer),
    f.questions.answer("chat", "message", "item", answer),
  ]);
  expect(results.map((r) => r.status)).toEqual(["fulfilled", "rejected"]);
  expect(f.run.steer).toHaveBeenCalledTimes(1);
});

it("doesn't inject an answer into another agent or conversation, and preserves their settings", async () => {
  for (const input of [
    { provider: "claude" as const, to: "claude" as const },
    { parentId: "other-thread" },
  ]) {
    const f = fixture();
    f.run.input = { ...f.run.input!, ...input };
    await f.questions.answer("chat", "message", "item", answer);
    expect(f.run.steer).not.toHaveBeenCalled();
    expect(f.send).toHaveBeenCalledWith(
      "chat",
      expect.objectContaining({
        provider: "codex",
        to: "codex",
        runtimeMode: "approval-required",
      }),
    );
    expect(f.send.mock.calls[0][1].delivery).toBeUndefined();
  }
});

it("leaves a failed follow-up answerable and never silently loses the reply", async () => {
  const f = fixture();
  f.run.steer = undefined;
  f.send.mockRejectedValueOnce(new Error("Queue full"));
  await expect(
    f.questions.answer("chat", "message", "item", answer),
  ).rejects.toThrow("Queue full");
  expect(f.message.questions![0].answers).toBeUndefined();
});
