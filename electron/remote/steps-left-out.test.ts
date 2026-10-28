import { describe, expect, it } from "vitest";
import type {
  AgentActivity,
  AgentTrace,
  ChatMessage,
} from "../../shared/projects";
import { turnHeading } from "../../shared/agent-trace";
import { stepsAsAsked, withStepsLeftOut } from "./steps-left-out";

const call = (
  id: string,
  kind: AgentActivity["kind"],
  label: string,
  extra: Partial<AgentActivity> = {},
): AgentTrace => ({
  kind: "activity",
  id,
  activity: { id, kind, label, status: "complete", ...extra },
});

const note = (id: string, text: string): AgentTrace => ({
  kind: "commentary",
  id,
  text,
});

function answer(
  id: string,
  trace: AgentTrace[],
  extra: Partial<ChatMessage> = {},
): ChatMessage {
  return {
    id,
    role: "assistant",
    body: "Done.",
    status: "complete",
    created: 1,
    version: 1,
    trace,
    ...extra,
  } as ChatMessage;
}

const heading = (message: ChatMessage) => {
  const read = turnHeading(message, false);
  return read.kind === "done" ? read.text : read.kind;
};

const keptIds = (message: ChatMessage) => message.trace?.map((e) => e.id);

describe("withStepsLeftOut", () => {
  const busyTurn = answer(
    "a1",
    [
      note("n1", "Looking around first."),
      call("r1", "read", "src/a.ts"),
      call("r2", "read", "src/a.ts"),
      call("r3", "read", "src/b.ts"),
      call("shot", "read", "shot.png"),
      call("c1", "command", "npm test"),
      call("c2", "command", "npm test", { status: "failed" }),
      call("ag", "agent", "Explore"),
      call("sub", "read", "src/c.ts", { parentId: "ag" }),
      call("ask", "tool", "AskUserQuestion"),
      call("start", "tool", "start_threads", {
        mcp: { server: "relay", tool: "start_threads" },
      }),
      call("e1", "file", "src/a.ts"),
      call("e2", "file", "src/a.ts"),
      call("c3", "command", "npm run typecheck"),
    ],
    { traceDropped: { command: 40, failed: 2 } },
  );

  it("says what the whole turn's heading reads", () => {
    expect(withStepsLeftOut(busyTurn).stepsSummary).toBe(heading(busyTurn));
  });

  it("keeps the calls shown outside the fold and the last", () => {
    const folded = withStepsLeftOut(busyTurn);
    expect(keptIds(folded)).toEqual(["shot", "start", "c3"]);
    expect(folded.stepsLeftOut).toBe(11);
  });

  it("leaves a turn without calls as it is", () => {
    const turn = answer("a3", [note("n1", "Just thinking out loud.")]);
    expect(withStepsLeftOut(turn)).toBe(turn);
  });
});

describe("stepsAsAsked", () => {
  const older = answer("old", [
    call("r1", "read", "a.ts"),
    call("c1", "command", "ls"),
  ]);
  const asked = { id: "u2", role: "user", body: "and now?" } as ChatMessage;
  const newest = answer("new", [
    call("r2", "read", "b.ts"),
    call("c2", "command", "ls"),
  ]);

  it("folds finished turns but the newest", () => {
    const [first, second, third] = stepsAsAsked(
      [older, asked, newest],
      "latest",
    );
    expect((first as ChatMessage).stepsLeftOut).toBe(1);
    expect(second).toBe(asked);
    expect(third).toBe(newest);
  });

  it("sends a streaming turn and ones the phone holds as they are", () => {
    const running = { ...older, status: "streaming" } as ChatMessage;
    expect(stepsAsAsked(["held", running, newest], "latest")).toEqual([
      "held",
      running,
      newest,
    ]);
  });

  it("folds nothing for a phone that didn't ask", () => {
    const messages = [older, newest];
    expect(stepsAsAsked(messages)).toBe(messages);
  });
});
