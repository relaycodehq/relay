import { expect, it, vi } from "vitest";
import { AnswerRecorder, streamingAnswer } from "./answer-recorder";
import type { AgentActivity, ProjectChat } from "../../shared/projects";

const call = (id: string, parentId?: string): AgentActivity =>
  ({
    id,
    kind: "command",
    label: id,
    status: "running",
    ...(parentId ? { parentId } : {}),
  }) as AgentActivity;

it("keeps the agent's own calls once the trace is full, dropping subagent ones first", () => {
  vi.useFakeTimers();
  const message = streamingAnswer("claude");
  const chat = { id: "c", messages: [message] } as unknown as ProjectChat;
  const answer = new AnswerRecorder(
    chat,
    message,
    () => {},
    () => {},
  );
  answer.activity(call("sub-1", "agent"));
  for (let i = 0; i < 99; i++) answer.activity(call(`own-${i}`));
  answer.activity(call("late"));
  answer.activity(call("sub-2", "agent"));
  const ids = message.trace!.map((e) => e.id);
  expect(ids).toHaveLength(100);
  expect(ids).not.toContain("sub-1");
  expect(ids.at(-1)).toBe("late");
  // A full trace takes no new subagent calls, but updates what it holds.
  expect(ids).not.toContain("sub-2");
  answer.activity({ ...call("late"), status: "complete" });
  expect(message.trace!.at(-1)).toMatchObject({
    activity: { status: "complete" },
  });
  answer.end();
  vi.useRealTimers();
});

it("makes a fresh async question unread activity without doing so again on replay", () => {
  vi.useFakeTimers();
  try {
    vi.setSystemTime(2000);
    const message = streamingAnswer("codex");
    const chat = {
      id: "c",
      updated: 1000,
      seenAt: 1000,
      messages: [message],
    } as ProjectChat;
    const answer = new AnswerRecorder(
      chat,
      message,
      () => {},
      () => {},
    );
    const questions = [{ id: "q", question: "Which?" }];
    answer.questions("item", questions);
    expect(chat.updated).toBeGreaterThan(chat.seenAt!);
    vi.setSystemTime(3000);
    answer.questions("item", questions);
    expect(chat.updated).toBe(2000);
    expect(message.questions).toHaveLength(1);
    answer.end();
  } finally {
    vi.useRealTimers();
  }
});

it("keeps a resumed answer whole when the taken-back session replays the steer it read", () => {
  vi.useFakeTimers();
  try {
    const above = streamingAnswer("codex");
    const steer = {
      id: "steer",
      role: "user",
      body: "use subagents",
      status: "complete",
      created: above.created + 10,
      version: 1,
    } as ProjectChat["messages"][number];
    const chat = { id: "c", messages: [above, steer] } as ProjectChat;
    const before = new AnswerRecorder(
      chat,
      above,
      () => {},
      () => {},
    );
    before.activity(call("first"));
    before.continueBelow("steer");
    before.activity(call("second"));
    const below = before.message;
    expect(chat.messages).toEqual([above, steer, below]);

    // Relay restarted: the turn carries on in the answer it was writing.
    const resumed = new AnswerRecorder(
      chat,
      below,
      () => {},
      () => {},
    );
    resumed.continueBelow("steer");
    resumed.activity(call("second"));
    resumed.activity(call("third"));
    expect(resumed.message).toBe(below);
    expect(chat.messages).toEqual([above, steer, below]);
    expect(below.status).toBe("streaming");
    expect(below.trace!.map((e) => e.id)).toEqual(["second", "third"]);
    resumed.end();
  } finally {
    vi.useRealTimers();
  }
});
