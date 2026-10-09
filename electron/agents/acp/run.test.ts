import { mkdtemp, readFile, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import type { AgentOptions } from "../types";
import type { AcpProfile } from "./profiles";
import { runAcp } from "./run";
import { disposeAcp } from "./sessions";
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
});

const options = (cwd: string, more: Partial<AgentOptions> = {}): AgentOptions => ({
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
  update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text } },
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
      { update: { sessionUpdate: "tool_call_update", toolCallId: "t1", status: "completed" } },
      { update: { sessionUpdate: "usage_update", used: 900, size: 1000, cost: { amount: 0.5, currency: "USD" } } },
      { update: { sessionUpdate: "usage_update", used: 950, size: 1000, cost: { amount: 0.75, currency: "USD" } } },
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
  // The first report is the session's spend before this turn; only the rise counts.
  expect(costs).toEqual([0.25]);
  expect(onUsage.mock.calls[0][0].tokens).toMatchObject({ input: 10, output: 5 });
  const methods = (await sent()).map((m) => m.method);
  expect(methods).toContain("session/set_config_option");
  expect(methods).not.toContain("session/cancel");
  const prompt = (await sent()).find((m) => m.method === "session/prompt");
  expect(prompt?.params.prompt).toEqual([{ type: "text", text: "Hi" }]);
});

it("asks the user when the mode does, and answers with the option they picked", async () => {
  const { acp, root, sent } = await agent({
    turn: [{ ask: { toolCall: { ...editing, rawInput: { command: "rm -rf build" } }, options: allowOrReject } }, say("ok")],
  });
  const onRequest = vi.fn(async () => ({ kind: "approval" as const, decision: "acceptForSession" as const }));
  await runAcp(acp, options(root, { runtimeMode: "approval-required", onRequest }));

  expect(onRequest).toHaveBeenCalledWith(
    expect.objectContaining({
      title: "Edit a.ts",
      detail: "rm -rf build",
      decisions: ["accept", "acceptForSession", "decline"],
    }),
    expect.anything(),
  );
  const reply = (await sent()).find((m) => m.method === undefined && m.result);
  expect(reply?.result).toEqual({ outcome: { outcome: "selected", optionId: "always" } });
});

it("answers on the user's behalf where the mode decides, without asking", async () => {
  const onRequest = vi.fn();
  const answered = async (more: Partial<AgentOptions>) => {
    const { acp, root, sent } = await agent({
      turn: [{ ask: { toolCall: editing, options: allowOrReject } }, say("ok")],
    });
    await runAcp(acp, options(root, { onRequest, ...more }));
    return (await sent()).find((m) => m.method === undefined)?.result.outcome.optionId;
  };

  expect(await answered({ runtimeMode: "full-access" })).toBe("yes");
  expect(await answered({ runtimeMode: "auto-accept-edits" })).toBe("yes");
  expect(await answered({ runtimeMode: "full-access", readOnly: true })).toBe("no");
  expect(await answered({ runtimeMode: "approval-required", onRequest: undefined })).toBe("no");
  expect(onRequest).not.toHaveBeenCalled();
});

it("cancels the agent's turn when the user stops it", async () => {
  const { acp, root, sent } = await agent({ turn: [say("Working…"), { waitCancel: true }] });
  const stop = new AbortController();
  const running = runAcp(
    acp,
    options(root, { signal: stop.signal, onText: (text) => text && stop.abort() }),
  );

  await expect(running).rejects.toThrow("Cancelled by you.");
  expect((await sent()).some((m) => m.method === "session/cancel")).toBe(true);
});

it("calls a signed-out agent signed out without signing it in, or starting it when its files say so", async () => {
  const refusing = await agent({ signIn: "oauth-personal", turn: [say("Hello")] });
  await expect(runAcp(refusing.acp, options(refusing.root))).rejects.toThrow(
    "Antigravity is signed out",
  );
  expect((await refusing.sent()).map((m) => m.method)).not.toContain("authenticate");

  const known = await agent({ turn: [say("Hello")] }, { account: async () => ({ signedIn: false }) });
  await expect(runAcp(known.acp, options(known.root))).rejects.toThrow("Antigravity is signed out");
  expect(await known.sent()).toEqual([]);
});

it("signs in from Relay the way the agent offers, and nothing else", async () => {
  const able = await agent({ signIn: "oauth-personal" }, { authMethod: async () => "oauth-personal" });
  await signInAcp(able.acp);
  expect((await able.sent()).find((m) => m.method === "authenticate")?.params).toEqual({
    methodId: "oauth-personal",
  });

  const unable = await agent({ signIn: "oauth-personal" }, { authMethod: async () => "vertex-ai" });
  await expect(signInAcp(unable.acp)).rejects.toThrow("can't sign in from Relay");
});

it("picks up the thread's session, and starts over with a note when it is gone", async () => {
  const { acp, root, sent } = await agent({ resume: true, sessions: ["kept"], turn: [say("ok")] });
  const onId = vi.fn(async () => {});
  const onCommentary = vi.fn();
  await runAcp(acp, options(root, { session: { key: "a", id: "kept", onId }, onCommentary }));
  expect(onId).not.toHaveBeenCalled();
  expect(onCommentary).not.toHaveBeenCalled();

  await runAcp(acp, options(root, { session: { key: "b", id: "gone", onId }, onCommentary }));
  expect(onId).toHaveBeenCalledWith("s1");
  expect(onCommentary).toHaveBeenCalledWith("antigravity-lost", expect.stringContaining("new one"));
  const opened = (await sent()).filter((m) => m.method?.startsWith("session/") && m.method !== "session/prompt");
  expect(opened.map((m) => [m.method, m.params.sessionId])).toEqual([
    ["session/resume", "kept"],
    ["session/resume", "gone"],
    ["session/new", undefined],
  ]);
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
