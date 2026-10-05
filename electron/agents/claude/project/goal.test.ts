import { expect, it, vi } from "vitest";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { runClaudeProject } from "./index";
import type { ThreadGoal } from "../../../../shared/goal";

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({ query: vi.fn() }));
vi.mock("../../../platform/executables", () => ({
  findExecutable: async (name: string) => `/usr/bin/${name}`,
  installStamp: async (path: string) => `${path} 2.1.288`,
}));

// Frames as Claude Code 2.1.288 wrote them for `/goal` over the SDK.
const session_id = "session";
const objective = "one.txt, two.txt and three.txt exist";
const said = (text: string, model = "claude-haiku-4-5-20251001") => ({
  type: "assistant",
  parent_tool_use_id: null,
  session_id,
  message: {
    id: crypto.randomUUID(),
    model,
    content: [{ type: "text", text }],
    usage: {},
  },
});
const unmet = (reason: string) => ({
  type: "user",
  parent_tool_use_id: null,
  isSynthetic: true,
  session_id,
  message: {
    role: "user",
    content: [
      { type: "text", text: `Stop hook feedback:\n[${objective}]: ${reason}` },
    ],
  },
});
const blockCap = {
  type: "system",
  subtype: "notification",
  key: "stop-hook-block-cap",
  text: "A hook blocked the turn from ending 9 consecutive times — overriding and ending turn.",
  session_id,
};
const result = (text: string) => ({
  type: "result",
  subtype: "success",
  is_error: false,
  result: text,
  terminal_reason: "completed",
  session_id,
});
const started = (uuid: string) => ({
  type: "command_lifecycle",
  command_uuid: uuid,
  state: "started",
  session_id,
});

function claude(frames: object[]) {
  vi.mocked(query).mockImplementation(({ prompt }) => {
    const input = (prompt as AsyncIterable<{ uuid: string }>)[
      Symbol.asyncIterator
    ]();
    return Object.assign(
      (async function* () {
        const sent = await input.next();
        yield started(sent.value.uuid);
        yield* frames;
        await new Promise(() => {});
      })(),
      { close() {}, getContextUsage: async () => ({ rawMaxTokens: 200_000 }) },
    ) as unknown as ReturnType<typeof query>;
  });
}

async function turn(frames: object[], goal?: ThreadGoal) {
  claude(frames);
  const goals: (ThreadGoal | null)[] = [];
  const notes: string[] = [];
  const answer = await runClaudeProject({
    job: { kind: "prompt" },
    cwd: "/project",
    prompt: `/goal ${objective}`,
    choice: {} as never,
    model: "",
    effort: "",
    signal: new AbortController().signal,
    onText() {},
    onCommentary: (_, text) => void (text && notes.push(text)),
    onGoal: (g) => goals.push(g),
    ...(goal ? { goal } : {}),
    session: { key: crypto.randomUUID(), id: session_id, async onId() {} },
  });
  return { answer, goals, notes };
}

it("reads a goal Claude met on its first check as complete", async () => {
  const { answer, goals } = await turn([
    said(`Goal set: ${objective}`, "<synthetic>"),
    said("Done! I've created all three files."),
    result("Done! I've created all three files."),
  ]);
  expect(answer).toBe("Done! I've created all three files.");
  expect(goals.map((g) => g?.status)).toEqual(["active", "complete"]);
  expect(goals.at(-1)).toMatchObject({ provider: "claude", objective });
});

it("counts unmet checks, keeping each step's reply above the answer", async () => {
  const { answer, goals, notes } = await turn([
    said(`Goal set: ${objective}`, "<synthetic>"),
    said("Created one.txt."),
    unmet("two.txt and three.txt are missing."),
    said("All three exist now."),
    result("All three exist now."),
  ]);
  expect(answer).toBe("All three exist now.");
  expect(notes).toContain("Created one.txt.");
  expect(goals[1]).toMatchObject({
    status: "active",
    checks: 1,
    lastCheck: "two.txt and three.txt are missing.",
  });
  expect(goals.at(-1)).toMatchObject({ status: "complete", checks: 1 });
});

it("keeps the goal set, not complete, when Claude stops checking after too many", async () => {
  const { answer, goals } = await turn([
    said(`Goal set: ${objective}`, "<synthetic>"),
    said("Waiting for your input."),
    unmet("The user has not typed approved."),
    said("Standing by."),
    unmet("Still not approved."),
    blockCap,
    result(""),
  ]);
  expect(goals.at(-1)).toMatchObject({
    status: "active",
    gaveUp: true,
    checks: 2,
  });
  // Its replies went above as steps; the turn still says how it ended.
  expect(answer).toMatch(/stopped working toward the goal after 2 checks/);
  expect(answer).toContain("Last check: Still not approved.");
});

it("forgets the goal when Claude clears it", async () => {
  const goal: ThreadGoal = {
    provider: "claude",
    objective,
    status: "active",
    updated: 1,
  };
  const { goals } = await turn(
    [
      said(`Goal cleared: ${objective}`, "<synthetic>"),
      result(`Goal cleared: ${objective}`),
    ],
    goal,
  );
  expect(goals).toEqual([null]);
});

it("doesn't call a goal met by a turn that only showed it", async () => {
  const goal: ThreadGoal = {
    provider: "claude",
    objective,
    status: "active",
    checks: 3,
    updated: 1,
  };
  const text = `Goal active: ${objective} (not yet evaluated)`;
  const { goals } = await turn([said(text, "<synthetic>"), result(text)], goal);
  // A resumed session counts again from its restore.
  expect(goals).toEqual([
    expect.objectContaining({ status: "active", checks: 0 }),
  ]);
});
