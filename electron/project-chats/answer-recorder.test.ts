import { expect, it, vi } from "vitest";
import {
  AnswerRecorder,
  streamingAnswer,
} from "./answer-recorder";
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
