import { mkdtemp, readFile, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import type { AgentOptions } from "../types";
import type { AcpProfile } from "./profiles";
import { runAcp } from "./run";
import { disposeAcp, acquireAcpAgent } from "./sessions";
import { antigravityBatches } from "../antigravity";
import { signInAcp } from "./sign-in";

const fixture = join(__dirname, "../../../tests/fixtures/acp-agent.cjs");

type Scenario = Record<string, unknown>;
type Sent = { id?: number; method?: string; params?: any; result?: any };

/** An Antigravity-like profile starting the fixture agent on `scenario`. */
async function agent(scenario: Scenario, profile: Partial<AcpProfile> = {}) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "relay-acp-")));
  const log = join(root, "sent.jsonl");
  const acp: AcpProfile = {
    provider: "antigravity",
    name: "Antigravity",
    home: root,
    command: async () => ({
      command: process.execPath,
      args: [fixture],
      env: {
        RELAY_ACP_SCENARIO: JSON.stringify(scenario),
        RELAY_ACP_LOG: log,
      },
    }),
    wishes: ({ runtime }) => [
      { option: "mode", value: runtime === "full-access" ? "yolo" : "default" },
    ],
    install: "",
    ...profile,
  };
  profiles.push(acp);
  const sent = async (): Promise<Sent[]> =>
    (await readFile(log, "utf8").catch(() => ""))
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  return { acp, root, sent };
}
const profiles: AcpProfile[] = [];
afterEach(() => {
  for (const profile of profiles.splice(0)) disposeAcp(profile);
  vi.unstubAllEnvs();
});

it.each(["antigravity", "amp", "opencode"] as const)(
  "uses the Antigravity model compatibility identity only for Antigravity (%s)",
  async (provider) => {
    const { acp, root, sent } = await agent({}, { provider });
    await acquireAcpAgent(acp, undefined, root);
    expect(
      (await sent()).find((message) => message.method === "initialize")?.params
        .clientInfo,
    ).toEqual({
      name: provider === "antigravity" ? "zed" : "relay",
      title: "Relay",
      version: "0.1.0",
    });
  },
);

it("shows native fixed choices in full access, preserving duplicate labels and recording readable answers", async () => {
  const id = "interaction_choose";
  const { acp, root, sent } = await agent({
    turn: [
      {
        ask: {
          toolCall: {
            toolCallId: id,
            title: "Which environment?",
            kind: "other",
          },
          options: [
            { optionId: "dev", name: "Same label", kind: "allow_once" },
            { optionId: "prod", name: "Same label", kind: "allow_once" },
          ],
        },
      },
      say("Chosen."),
    ],
  });
  const onRequest = vi.fn(async () => ({
    kind: "question" as const,
    answers: { [id]: ["prod"] },
  }));
  const onActivity = vi.fn();
  await runAcp(
    acp,
    options(root, { runtimeMode: "full-access", onRequest, onActivity }),
  );
  expect(onRequest).toHaveBeenCalledWith(
    expect.objectContaining({
      kind: "question",
      questions: [
        expect.objectContaining({
          id,
          allowCustomAnswer: false,
          options: [
            { label: "Same label", value: "dev" },
            { label: "Same label", value: "prod" },
          ],
        }),
      ],
    }),
    expect.anything(),
  );
  expect((await sent()).find((m) => !m.method)?.result).toEqual({
    outcome: { outcome: "selected", optionId: "prod" },
  });
  expect(onActivity).toHaveBeenLastCalledWith(
    expect.objectContaining({
      status: "complete",
      questionAnswers: [
        { question: "Which environment?", answer: "Same label" },
      ],
    }),
  );
});

it("never auto-approves a malformed native question, or accepts a free-text answer", async () => {
  for (const answer of ["not an option", "yes"]) {
    const { acp, root, sent } = await agent({
      turn: [
        {
          ask: {
            toolCall: { toolCallId: "interaction_q", title: "Pick one." },
            options: allowOrReject,
          },
        },
      ],
    });
    await runAcp(
      acp,
      options(root, {
        onRequest: async () =>
          answer === "yes"
            ? { kind: "approval", decision: "accept" }
            : { kind: "question", answers: { interaction_q: [answer] } },
      }),
    );
    expect((await sent()).find((m) => !m.method)?.result).toEqual({
      outcome: { outcome: "cancelled" },
    });
  }
  const malformed = await agent({
    turn: [
      {
        ask: {
          toolCall: { toolCallId: "interaction_bad", title: "Pick one." },
          options: [{ optionId: "", kind: "allow_once", name: "Broken" }],
        },
      },
    ],
  });
  const onRequest = vi.fn();
  await runAcp(malformed.acp, options(malformed.root, { onRequest }));
  expect(onRequest).not.toHaveBeenCalled();
  expect((await malformed.sent()).find((m) => !m.method)?.result).toEqual({
    outcome: { outcome: "cancelled" },
  });
});

it("dispatches native compact and plan commands first, keeping context inside the planning request", async () => {
  const { acp, root, sent } = await agent(
    { turn: [say("Done.")] },
    { provider: "opencode", compact: "/compact", plan: "/plan" },
  );
  const context = vi.fn(async () => "Workspace note.");
  await runAcp(acp, options(root, { job: { kind: "compact" }, context }));
  expect(context).not.toHaveBeenCalled();
  const onPlan = vi.fn();
  await runAcp(
    acp,
    options(root, {
      interactionMode: "plan",
      prompt: "Design the API.",
      context,
      onPlan,
    }),
  );
  expect(
    (await sent())
      .filter((m) => m.method === "session/prompt")
      .map((m) => m.params.prompt),
  ).toEqual([
    [{ type: "text", text: "/compact" }],
    [{ type: "text", text: "/plan Workspace note.\n\nDesign the API." }],
  ]);
  expect(onPlan).toHaveBeenLastCalledWith("Done.");
});

it("updates the live planning checklist, and leaves execution checklists out of proposed plans", async () => {
  const { acp, root } = await agent(
    {
      turn: [
        {
          update: {
            sessionUpdate: "plan",
            entries: [{ content: "Read the API", status: "in_progress" }],
          },
        },
        {
          update: {
            sessionUpdate: "plan",
            entries: [{ content: "Read the API", status: "completed" }],
          },
        },
        say("The proposed plan."),
      ],
    },
    { plan: "/plan" },
  );
  const onPlan = vi.fn(),
    onActivity = vi.fn();
  await runAcp(
    acp,
    options(root, { interactionMode: "plan", onPlan, onActivity }),
  );
  expect(onPlan.mock.calls.map(([text]) => text)).toEqual([
    "- [ ] Read the API (working on it)",
    "- [x] Read the API",
    "The proposed plan.",
  ]);
  expect(onActivity.mock.calls.map(([a]) => a.status)).toEqual([
    "running",
    "complete",
  ]);
  onPlan.mockClear();
  await runAcp(acp, options(root, { onPlan }));
  expect(onPlan).not.toHaveBeenCalled();
});

it("tracks native subagent batches without claiming the children succeeded or allowing individual cancellation", async () => {
  const { acp, root } = await agent({
    turn: [
      {
        update: {
          sessionUpdate: "tool_call",
          toolCallId: "batch",
          title: "Running start_subagent",
          kind: "other",
          status: "in_progress",
        },
      },
      {
        update: {
          sessionUpdate: "tool_call_update",
          toolCallId: "batch",
          status: "completed",
          rawOutput: "Started two agents.",
        },
      },
      {
        update: {
          sessionUpdate: "tool_call",
          toolCallId: "mcp",
          title: "Running start_subagent",
          kind: "other",
          _meta: { is_mcp_tool_call: true },
        },
      },
    ],
  });
  await runAcp(
    acp,
    options(root, { session: { key: "batches", onId: async () => {} } }),
  );
  const source = antigravityBatches.get("batches")!;
  expect(source.list()).toEqual([
    expect.objectContaining({ id: "batch", status: "idle", canStop: false }),
  ]);
  expect(source.detail("batch")?.report).toBe("Started two agents.");
  await expect(source.stop("batch")).rejects.toThrow();
  antigravityBatches.drop("batches");
});

it("keeps text-only helper jobs out of the project and refuses attempted tools", async () => {
  const plain = await agent({ turn: [say('{"title":"A title"}')] });
  await runAcp(
    plain.acp,
    options(plain.root, {
      job: { kind: "helper", instructions: "Write a title." },
      session: { key: "must-not-be-used", onId: async () => {} },
      relayTools: { url: "http://localhost:1", token: "fixture" },
    }),
  );
  const opened = (await plain.sent()).find((m) => m.method === "session/new")!;
  expect(opened.params.cwd).not.toBe(plain.root);
  expect(opened.params.mcpServers).toEqual([]);
  expect(
    (await plain.sent()).find((m) => m.method === "session/prompt")?.params
      .prompt[0].text,
  ).toContain("Write a title.\n\nHi");

  const tool = await agent({
    turn: [{ update: { sessionUpdate: "tool_call", ...editing } }, say("done")],
  });
  await expect(
    runAcp(
      tool.acp,
      options(tool.root, { job: { kind: "helper", instructions: "" } }),
    ),
  ).rejects.toThrow("text-only helper");
});

it("restarts the process when a session changes accounts, retaining the account for a subsequent turn", async () => {
  const { acp, root, sent } = await agent(
    { resume: true, sessions: ["s1"] },
    { accountKey: "personal" },
  );
  await runAcp(
    acp,
    options(root, { session: { key: "accounts", onId: async () => {} } }),
  );
  const first = await acquireAcpAgent(acp, "accounts", root);
  first.busy = false;
  await runAcp(
    { ...acp, accountKey: "work" },
    options(root, {
      session: { key: "accounts", id: "s1", onId: async () => {} },
    }),
  );
  expect(first.closed).toBe(true);
  const second = await acquireAcpAgent(
    { ...acp, accountKey: "work" },
    "accounts",
    root,
  );
  expect(second).not.toBe(first);
  second.busy = false;
  expect((await sent()).filter((m) => m.method === "initialize")).toHaveLength(
    2,
  );
  await runAcp(
    { ...acp, accountKey: "work", credentialsRevision: "new-login" },
    options(root, {
      session: { key: "accounts", id: "s1", onId: async () => {} },
    }),
  );
  expect(second.closed).toBe(true);
  expect((await sent()).filter((m) => m.method === "initialize")).toHaveLength(
    3,
  );
});

it("does not merge a cleared ambient credential back into an account's process environment", async () => {
  vi.stubEnv("GEMINI_API_KEY", "inherited-fixture-key");
  const clean = { ...process.env } as Record<string, string>;
  delete clean.GEMINI_API_KEY;
  const { acp, root, sent } = await agent(
    { captureEnvKeys: ["GEMINI_API_KEY"] },
    { environment: clean },
  );
  await runAcp(acp, options(root));
  expect((await sent()).find((m: any) => m.environment)).toEqual({
    environment: { GEMINI_API_KEY: null },
  });
});

const options = (
  cwd: string,
  more: Partial<AgentOptions> = {},
): AgentOptions => ({
  job: { kind: "prompt" },
  cwd,
  prompt: "Hi",
  choice: { model: "", reasoningEffort: "", fast: false },
  runtimeMode: "full-access",
  interactionMode: "default",
  signal: new AbortController().signal,
  onText() {},
  ...more,
});

const say = (text: string) => ({
  update: {
    sessionUpdate: "agent_message_chunk",
    content: { type: "text", text },
  },
});

it("classifies prompt-time authentication refusals so the thread offers sign-in; leaves other failures alone", async () => {
  const auth = await agent(
    {
      promptError: {
        code: -32000,
        message: "Authentication required: provider authentication required",
      },
    },
    { provider: "opencode", name: "OpenCode" },
  );
  await expect(runAcp(auth.acp, options(auth.root))).rejects.toMatchObject({
    kind: "signedOut",
    provider: "opencode",
  });
  for (const code of [-32603, -32001]) {
    const failed = await agent({
      promptError: { code, message: "Provider request failed" },
    });
    await expect(
      runAcp(failed.acp, options(failed.root)),
    ).rejects.toMatchObject({ name: "AcpRequestError", code });
  }
});
const editing = {
  toolCallId: "t1",
  title: "Edit a.ts",
  kind: "edit",
  status: "pending",
  content: [{ type: "diff", path: "/p/a.ts", oldText: "a", newText: "b" }],
};
const allowOrReject = [
  { optionId: "yes", name: "Allow", kind: "allow_once" },
  { optionId: "always", name: "Always", kind: "allow_always" },
  { optionId: "no", name: "Reject", kind: "reject_once" },
];
const modeOption = {
  id: "mode",
  name: "Mode",
  category: "mode",
  type: "select",
  currentValue: "default",
  options: [
    { value: "default", name: "Default" },
    { value: "yolo", name: "YOLO" },
  ],
};

it("splits text before a tool call into commentary and reports edits, cost and settings", async () => {
  const { acp, root, sent } = await agent({
    configOptions: [modeOption],
    turn: [
      say("Let me look."),
      { update: { sessionUpdate: "tool_call", ...editing } },
      {
        update: {
          sessionUpdate: "tool_call_update",
          toolCallId: "t1",
          status: "completed",
        },
      },
      {
        update: {
          sessionUpdate: "usage_update",
          used: 900,
          size: 1000,
          cost: { amount: 0.5, currency: "USD" },
        },
      },
      {
        update: {
          sessionUpdate: "usage_update",
          used: 950,
          size: 1000,
          cost: { amount: 0.75, currency: "USD" },
        },
      },
      say("Done."),
    ],
    usage: { inputTokens: 10, outputTokens: 2, thoughtTokens: 3 },
  });
  const commentary: [string, string | null][] = [];
  const activities: unknown[] = [];
  const edits: string[][] = [];
  const costs: number[] = [];
  const onUsage = vi.fn();
  const answer = await runAcp(
    acp,
    options(root, {
      onCommentary: (id, text) => commentary.push([id, text]),
      onActivity: (a) => activities.push(a),
      onEdit: (paths) => edits.push(paths),
      onCost: (usd) => costs.push(usd),
      onUsage,
    }),
  );

  expect(answer).toBe("Done.");
  expect(commentary).toEqual([["antigravity-0", "Let me look."]]);
  expect(activities.at(-1)).toMatchObject({ id: "t1", status: "complete" });
  expect(edits[0]).toEqual(["/p/a.ts"]);
  // A new session starts at $0, so its first report is all this turn's.
  expect(costs).toEqual([0.5, 0.25]);
  expect(onUsage.mock.calls[0][0].tokens).toMatchObject({
    input: 10,
    output: 5,
  });
  const methods = (await sent()).map((m) => m.method);
  expect(methods).toContain("session/set_config_option");
  expect(methods).not.toContain("session/cancel");
  const prompt = (await sent()).find((m) => m.method === "session/prompt");
  expect(prompt?.params.prompt).toEqual([{ type: "text", text: "Hi" }]);
});

it("asks the user when the mode does, and answers with the option they picked", async () => {
  const { acp, root, sent } = await agent({
    turn: [
      {
        ask: {
          toolCall: { ...editing, rawInput: { command: "rm -rf build" } },
          options: allowOrReject,
        },
      },
      say("ok"),
    ],
  });
  const onRequest = vi.fn(async () => ({
    kind: "approval" as const,
    decision: "acceptForSession" as const,
  }));
  await runAcp(
    acp,
    options(root, { runtimeMode: "approval-required", onRequest }),
  );

  expect(onRequest).toHaveBeenCalledWith(
    expect.objectContaining({
      title: "Edit a.ts",
      detail: "rm -rf build",
      decisions: ["accept", "acceptForSession", "decline"],
    }),
    expect.anything(),
  );
  const reply = (await sent()).find((m) => m.method === undefined && m.result);
  expect(reply?.result).toEqual({
    outcome: { outcome: "selected", optionId: "always" },
  });
});

it("answers on the user's behalf where the mode decides, without asking", async () => {
  const onRequest = vi.fn();
  const answered = async (more: Partial<AgentOptions>) => {
    const { acp, root, sent } = await agent({
      turn: [{ ask: { toolCall: editing, options: allowOrReject } }, say("ok")],
    });
    await runAcp(acp, options(root, { onRequest, ...more }));
    return (await sent()).find((m) => m.method === undefined)?.result.outcome
      .optionId;
  };

  expect(await answered({ runtimeMode: "full-access" })).toBe("yes");
  expect(await answered({ runtimeMode: "auto-accept-edits" })).toBe("yes");
  expect(await answered({ runtimeMode: "full-access", readOnly: true })).toBe(
    "no",
  );
  expect(
    await answered({ runtimeMode: "approval-required", onRequest: undefined }),
  ).toBe("no");
  expect(onRequest).not.toHaveBeenCalled();
});

it("cancels the agent's turn when the user stops it", async () => {
  const { acp, root, sent } = await agent({
    turn: [say("Working…"), { waitCancel: true }],
  });
  const stop = new AbortController();
  const running = runAcp(
    acp,
    options(root, {
      signal: stop.signal,
      onText: (text) => text && stop.abort(),
    }),
  );

  await expect(running).rejects.toThrow("Cancelled by you.");
  expect((await sent()).some((m) => m.method === "session/cancel")).toBe(true);
});

it("calls a signed-out agent signed out without signing it in, or starting it when its files say so", async () => {
  const refusing = await agent({
    signIn: "oauth-personal",
    turn: [say("Hello")],
  });
  await expect(runAcp(refusing.acp, options(refusing.root))).rejects.toThrow(
    "Antigravity is signed out",
  );
  expect((await refusing.sent()).map((m) => m.method)).not.toContain(
    "authenticate",
  );

  const known = await agent(
    { turn: [say("Hello")] },
    { account: async () => ({ signedIn: false }) },
  );
  await expect(runAcp(known.acp, options(known.root))).rejects.toThrow(
    "Antigravity is signed out",
  );
  expect(await known.sent()).toEqual([]);
});

it("signs in from Relay the way the agent offers, and nothing else", async () => {
  const able = await agent(
    { signIn: "oauth-personal" },
    { authMethod: async () => "oauth-personal" },
  );
  await signInAcp(able.acp);
  expect(
    (await able.sent()).find((m) => m.method === "authenticate")?.params,
  ).toEqual({
    methodId: "oauth-personal",
  });

  const unable = await agent(
    { signIn: "oauth-personal" },
    { authMethod: async () => "vertex-ai" },
  );
  await expect(signInAcp(unable.acp)).rejects.toThrow(
    "can't sign in from Relay",
  );
});

it("picks up the thread's session, and starts over with a note when it is gone", async () => {
  const { acp, root, sent } = await agent({
    resume: true,
    sessions: ["kept"],
    turn: [say("ok")],
  });
  const onId = vi.fn(async () => {});
  const onCommentary = vi.fn();
  await runAcp(
    acp,
    options(root, { session: { key: "a", id: "kept", onId }, onCommentary }),
  );
  expect(onId).not.toHaveBeenCalled();
  expect(onCommentary).not.toHaveBeenCalled();

  await runAcp(
    acp,
    options(root, { session: { key: "b", id: "gone", onId }, onCommentary }),
  );
  expect(onId).toHaveBeenCalledWith("s1");
  expect(onCommentary).toHaveBeenCalledWith(
    "antigravity-lost",
    expect.stringContaining("new one"),
  );
  const opened = (await sent()).filter(
    (m) => m.method?.startsWith("session/") && m.method !== "session/prompt",
  );
  expect(opened.map((m) => [m.method, m.params.sessionId])).toEqual([
    ["session/resume", "kept"],
    ["session/resume", "gone"],
    ["session/new", undefined],
  ]);
});

it("charges each turn what it added when the agent reports the session's total once a turn ends", async () => {
  const { acp, root } = await agent({
    resume: true,
    sessions: ["old"],
    spend: 0.25,
    spent: { old: 3 },
  });
  const costs: number[] = [];
  const turn = (key: string, id?: string) =>
    runAcp(
      acp,
      options(root, {
        session: { key, id, onId: async () => {} },
        onCost: (usd) => costs.push(usd),
      }),
    );

  await turn("new");
  await turn("new", "s1");
  expect(costs).toEqual([0.25, 0.25]);

  // A session picked up again ran up $3 Relay can't tell from this turn, so its first report only sets the mark.
  await turn("old", "old");
  await turn("old", "old");
  expect(costs).toEqual([0.25, 0.25, 0.25]);
});

it("fails a turn whose only answer is the agent reporting an error", async () => {
  const { acp, root } = await agent(
    { turn: [say("Error: You need to log in.")] },
    { failure: (answer) => /^Error: (.+)/s.exec(answer)?.[1] },
  );
  const onText = vi.fn();
  await expect(runAcp(acp, options(root, { onText }))).rejects.toThrow(
    "Antigravity: You need to log in.",
  );
  expect(onText).toHaveBeenLastCalledWith("");
});
