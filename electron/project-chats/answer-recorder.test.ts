import { expect, it, vi } from "vitest";
import { AnswerRecorder, streamingAnswer } from "./answer-recorder";
import type {
  AgentActivity,
  ChatMessage,
  ProjectChat,
} from "../../shared/projects";
import { readTurn, turnHeading } from "../../shared/agent-trace";

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

it("lets a long turn's oldest finished calls go, so the live row shows what runs now", () => {
  vi.useFakeTimers();
  const message = streamingAnswer("codex");
  const chat = { id: "c", messages: [message] } as unknown as ProjectChat;
  const answer = new AnswerRecorder(
    chat,
    message,
    () => {},
    () => {},
  );
  answer.activity(call("watch"));
  for (let i = 0; i < 120; i++)
    answer.activity({ ...call(`ls-${i}`), status: "complete" });
  answer.activity(call("build"));
  answer.commentary("note", "Now building the whole thing.");
  const turn = readTurn(message);
  expect(turn.current?.id).toBe("build");
  expect(message.trace!.length).toBeLessThanOrEqual(100);
  // The running call from the start stays; the summary still counts every call.
  expect(message.trace![0]!.id).toBe("watch");
  expect(message.trace!.at(-1)!.id).toBe("note");
  answer.activity({ ...call("build"), status: "complete" });
  answer.activity({ ...call("watch"), status: "complete" });
  message.status = "complete";
  answer.end();
  expect(turnHeading(message, false)).toMatchObject({
    text: "Ran 122 commands",
  });
  vi.useRealTimers();
});

it("marks the calls a Stop cut short as stopped, not failed", () => {
  vi.useFakeTimers();
  const message = streamingAnswer("codex");
  const chat = { id: "c", messages: [message] } as unknown as ProjectChat;
  const answer = new AnswerRecorder(
    chat,
    message,
    () => {},
    () => {},
  );
  answer.activity({ ...call("ls"), status: "complete" });
  answer.activity(call("rg"));
  answer.stop();
  expect(
    message.trace!.map((e) => e.kind === "activity" && e.activity.status),
  ).toEqual(["complete", "stopped"]);
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

it("moves the version of a change that came just before a checkpoint, so the checkpoint keeps it", () => {
  vi.useFakeTimers();
  const message = streamingAnswer("claude");
  const chat = { id: "c", messages: [message] } as unknown as ProjectChat;
  const saved: { body: string; version: number }[] = [];
  const answer = new AnswerRecorder(
    chat,
    message,
    () => {},
    () => saved.push({ body: message.body, version: message.version }),
  );
  answer.text("a");
  vi.advanceTimersByTime(40);
  const published = message.version;
  // Lands inside the 40ms a change waits to be published, right before the 1s checkpoint.
  vi.advanceTimersByTime(950);
  answer.text("ab");
  vi.advanceTimersByTime(10);
  expect(saved).toEqual([{ body: "ab", version: published + 1 }]);
  answer.end();
  vi.useRealTimers();
});

it("leaves an import offer out of what streams, and under the answer once it ends", () => {
  vi.useFakeTimers();
  const message = streamingAnswer("claude");
  const chat = { id: "c", messages: [message] } as unknown as ProjectChat;
  const emitted: ChatMessage[] = [];
  const answer = new AnswerRecorder(
    chat,
    message,
    (m) => emitted.push(m),
    () => {},
  );
  answer.importOffer({ id: "offer", app: "codex", projects: [] });
  answer.text("Tick what you want.");
  vi.advanceTimersByTime(1000);
  expect(emitted.length).toBeGreaterThan(0);
  expect(emitted.every((m) => !m.importOffer)).toBe(true);
  answer.end();
  expect(emitted.at(-1)!.importOffer?.id).toBe("offer");
  vi.useRealTimers();
});
