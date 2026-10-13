import { mkdtemp, readFile, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { findExecutable } from "../../platform/executables";
import { fakeCli } from "../../../tests/fixtures/fake-cli";
import { isAgentError } from "../errors";
import type { AgentOptions } from "../types";
import type { AgentActivity } from "../../../shared/projects";
import type { AgentRequest, AgentResponse } from "../../../shared/agent-modes";
import { closeCatalog, forgetMuseModels, museDefaults, museModels } from "./catalog";
import { runMuse } from "./run";
import { disposeMuse } from "./sessions";

vi.mock("../../platform/executables", async (actual) => ({
  ...(await actual<typeof import("../../platform/executables")>()),
  findExecutable: vi.fn(),
}));

type Sent = { id?: number; method?: string; params?: any };
let root = "";
let log = "";

/** Puts the fake `muse serve` on `scenario`. */
async function scenario(play: Record<string, unknown>) {
  vi.stubEnv("RELAY_MUSE_SCENARIO", JSON.stringify(play));
}
const sent = async (): Promise<Sent[]> =>
  (await readFile(log, "utf8").catch(() => ""))
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
const calls = async (method: string) => (await sent()).filter((m) => m.method === method);

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "relay-muse-")));
  log = join(root, "sent.jsonl");
  vi.stubEnv("RELAY_MUSE_LOG", log);
  vi.mocked(findExecutable).mockResolvedValue(
    await fakeCli(join(root, "muse"), await readFile(resolve("tests/fixtures/muse-serve.cjs"), "utf8")),
  );
});
afterEach(async () => {
  disposeMuse();
  forgetMuseModels();
  await closeCatalog();
  vi.unstubAllEnvs();
});

/** A thread turn, with what its callbacks heard. */
function turn(more: Partial<AgentOptions> = {}) {
  const heard = {
    text: "",
    commentary: new Map<string, string>(),
    activity: new Map<string, AgentActivity>(),
    edits: [] as string[],
    ids: [] as string[],
    steered: [] as string[],
    requests: [] as Omit<AgentRequest, "id">[],
    usage: [] as unknown[],
    context: [] as unknown[],
    titles: [] as string[],
  };
  const options: AgentOptions = {
    job: { kind: "prompt" },
    cwd: root,
    prompt: "Relay context\n\nFix the build",
    request: "Fix the build",
    choice: { model: "", reasoningEffort: "", fast: false },
    runtimeMode: "approval-required",
    interactionMode: "default",
    signal: new AbortController().signal,
    onText: (text) => void (heard.text = text),
    onCommentary: (id, text) => void (text === null ? heard.commentary.delete(id) : heard.commentary.set(id, text)),
    onActivity: (a) => void heard.activity.set(a.id, a),
    onEdit: (paths) => void heard.edits.push(...paths),
    onSteered: (id) => void heard.steered.push(id),
    onUsage: (u) => void heard.usage.push(u),
    onContext: (c) => void heard.context.push(c),
    onTitle: (t) => void heard.titles.push(t),
    session: { key: "thread-1", onId: async (id) => void heard.ids.push(id) },
    ...more,
  };
  return { options, heard, answer: () => runMuse(options) };
}

describe("a turn", () => {
  it("streams the answer, saves the session and runs Supervised as Muse's Ask me", async () => {
    await scenario({ turn: [{ text: "All fixed.", chunks: ["All ", "fixed."] }] });
    const { heard, answer } = turn();
    await expect(answer()).resolves.toBe("All fixed.");
    expect(heard.text).toBe("All fixed.");
    expect(heard.ids).toEqual(["session-1"]);
    const [start] = await calls("session/start");
    expect(start!.params).toMatchObject({ workspaceRoot: root, permissionProfile: ":ask-me", approvalMode: "promptUnmatched" });
    const [turnStart] = await calls("turn/start");
    // Relay's instructions and context go to the model; the transcript shows the user's words.
    expect(turnStart!.params.displayText).toBe("Fix the build");
    expect(turnStart!.params.input[0].text).toMatch(/^Help the requesting user/);
    expect(turnStart!.params.input.at(-1)).toEqual({ type: "text", text: "Relay context\n\nFix the build" });
  });

  it("shows tool calls as rows, what came before them as commentary, and hides Muse's own checks", async () => {
    await scenario({
      turn: [
        { text: "Looking at the build." },
        { tool: { tool: "shell", args: { command: "npm test" }, output: "1 failed" } },
        { tool: { tool: "edit_file", args: { path: "src/app.ts" }, extra: { patchSummary: { added: 3, removed: 1, files: 1 } } } },
        { reminder: true },
        { text: "Fixed the test." },
      ],
    });
    const { heard, answer } = turn();
    await expect(answer()).resolves.toBe("Fixed the test.");
    expect([...heard.commentary.values()]).toEqual(["Looking at the build."]);
    const rows = [...heard.activity.values()];
    expect(rows.map((r) => [r.kind, r.label, r.status])).toEqual([
      ["command", "npm test", "complete"],
      ["file", "src/app.ts", "complete"],
    ]);
    expect(rows[0]!.detail).toBe("1 failed");
    expect(rows[1]!.detail).toBe("+3 −1");
    expect(heard.edits).toContain("src/app.ts");
  });

  it("maps the other modes to Muse's profiles", async () => {
    await scenario({});
    await turn({ runtimeMode: "full-access", session: undefined }).answer();
    await turn({ runtimeMode: "auto", session: undefined }).answer();
    await turn({ readOnly: true, session: undefined }).answer();
    const starts = (await calls("session/start")).map((m) => [m.params.permissionProfile, m.params.approvalMode]);
    expect(starts).toEqual([
      [":unrestricted", "allowAll"],
      [":auto-review", "onRequest"],
      [":read-only", "denyUnmatched"],
    ]);
  });

  it("picks a skill with a leading /name and takes the effort per turn", async () => {
    await scenario({});
    await turn({
      prompt: "/review-pr 42 carefully",
      choice: { model: "muse-wonder-full-1.0", reasoningEffort: "ultra", fast: false },
    }).answer();
    const [start] = await calls("session/start");
    expect(start!.params.modelId).toBe("muse-wonder-full-1.0");
    const [turnStart] = await calls("turn/start");
    expect(turnStart!.params.reasoningEffort).toBe("ultra");
    expect(turnStart!.params.input.at(-1)).toEqual({ type: "skill", selector: "review-pr", arguments: "42 carefully" });
  });

  it("reports tokens, context, the plan and a title", async () => {
    await scenario({
      turn: [
        { usage: { model: "muse-wonder-full-1.0", tokens: { inputTokens: 1000, cachedTokens: 600, outputTokens: 50, reasoningTokens: 20 } } },
        { context: { usedTokens: 40000, windowTokens: 1000000, pressure: "low" } },
        { todos: [{ text: "Read the logs", status: "completed" }, { text: "Fix it", status: "inProgress" }] },
        { title: "Fix the build" },
        { text: "Ok." },
      ],
    });
    const { heard, answer } = turn();
    await answer();
    expect(heard.usage).toEqual([
      { model: "muse-wonder-full-1.0", tokens: { input: 400, cacheRead: 600, cacheWrite: 0, output: 50 } },
    ]);
    expect(heard.context).toEqual([{ usedTokens: 40000, maxTokens: 1000000 }]);
    expect([...heard.activity.values()].find((a) => a.label === "Updated the plan")?.detail).toBe("✓ Read the logs\n→ Fix it");
    expect(heard.titles).toEqual(["Fix the build"]);
  });
});

describe("approvals and questions", () => {
  it("asks the user and answers with the choice they picked", async () => {
    await scenario({ turn: [{ approval: {} }, { approval: {} }, { text: "Done." }] });
    const answers: AgentResponse[] = [
      { kind: "approval", decision: "acceptForSession" },
      { kind: "approval", decision: "decline" },
    ];
    const { heard, answer } = turn({
      onRequest: async (request) => {
        heard.requests.push(request);
        return answers.shift()!;
      },
    });
    await answer();
    expect(heard.requests[0]).toMatchObject({
      kind: "approval",
      title: "Muse Code wants to run a command",
      detail: "rm -rf build",
      decisions: ["accept", "acceptForSession", "decline"],
    });
    expect((await calls("approval/decide")).map((m) => m.params.choiceId)).toEqual(["session", "no"]);
  });

  it("refuses for a helper job without asking anyone", async () => {
    await scenario({ turn: [{ approval: {} }, { text: "Title" }] });
    const onRequest = vi.fn();
    await turn({ job: { kind: "helper", instructions: "Write a title." }, session: undefined, onRequest }).answer();
    expect(onRequest).not.toHaveBeenCalled();
    expect((await calls("approval/decide")).map((m) => m.params.choiceId)).toEqual(["no"]);
  });

  it("puts Muse's questions to the user, picked labels and free text apart", async () => {
    await scenario({
      turn: [
        {
          question: [
            { id: "q1", header: "Target", question: "Which env?", options: [{ label: "staging" }, { label: "prod" }], selection: { mode: "single" } },
            { id: "q2", header: "Why", question: "Anything else?", options: [], selection: { mode: "single" } },
          ],
        },
        { text: "Deploying." },
      ],
    });
    const { heard, answer } = turn({
      onRequest: async (request) => {
        heard.requests.push(request);
        return { kind: "question", answers: { q1: ["staging"], q2: ["be quick"] } };
      },
    });
    await answer();
    expect(heard.requests[0]!.questions?.[0]).toMatchObject({ id: "q1", question: "Which env?", options: [{ label: "staging" }, { label: "prod" }] });
    const [answered] = await calls("userInput/answer");
    expect(answered!.params.answers).toEqual([
      { questionId: "q1", selectedLabel: "staging" },
      { questionId: "q2", freeText: "be quick" },
    ]);
  });
});

describe("control", () => {
  it("steers the running turn and says which message it read", async () => {
    await scenario({ turn: [{ text: "Working." }, { waitSteer: true }, { text: "Switched to staging." }] });
    let steer: ((text: string, id?: string) => Promise<void>) | undefined;
    const { heard, answer } = turn({ onControl: (control) => void (steer = control.steer) });
    const running = answer();
    await vi.waitFor(() => expect(steer).toBeDefined());
    await steer!("use staging", "message-7");
    await expect(running).resolves.toBe("Switched to staging.");
    const [sentSteer] = await calls("turn/steer");
    expect(sentSteer!.params).toMatchObject({ expectedTurnId: expect.any(String), input: [{ type: "text", text: "use staging" }] });
    expect(heard.steered).toEqual(["message-7"]);
  });

  it("interrupts on Stop", async () => {
    await scenario({ turn: [{ text: "Starting." }, { hang: true }] });
    const stop = new AbortController();
    const { answer } = turn({ signal: stop.signal });
    const running = answer();
    await vi.waitFor(async () => expect(await calls("turn/start")).toHaveLength(1));
    stop.abort();
    await expect(running).rejects.toThrow("Cancelled by you.");
    expect(await calls("turn/interrupt")).toHaveLength(1);
  });

  it("compacts the session and says by how much", async () => {
    await scenario({});
    await turn().answer();
    await expect(turn({ job: { kind: "compact" }, session: { key: "thread-1", id: "session-1", onId: async () => {} } }).answer()).resolves.toBe(
      "Compacted the conversation from 120,000 to 9,000 tokens.",
    );
  });
});

describe("failures", () => {
  it("reads a missing login as signed out", async () => {
    await scenario({ signedOut: true });
    const error = await turn().answer().catch((e) => e);
    expect(isAgentError(error, "signedOut")).toBe(true);
  });

  it("reads a spent quota as a usage limit with its reset time", async () => {
    await scenario({ turn: [{ fail: { kind: "modelError", message: "Weekly limit reached.", quota: { limitKind: "tierLimit", resetsAtMs: 1_900_000_000_000 } } }] });
    const error = await turn().answer().catch((e) => e);
    expect(isAgentError(error, "usageLimit")).toBe(true);
    expect(error.resetsAt).toBe(1_900_000_000_000);
  });

  it("starts over when the saved conversation is gone, and says so", async () => {
    await scenario({ resume: "missing" });
    const { heard, answer } = turn({ session: { key: "thread-2", id: "gone", onId: async (id) => void heard.ids.push(id) } });
    await answer();
    expect(heard.ids).toEqual(["session-1"]);
    expect([...heard.commentary.values()].join()).toMatch(/couldn't open the earlier conversation/);
  });

  it("says where a conversation open in another Muse is", async () => {
    await scenario({ resume: "inUse" });
    await expect(turn({ session: { key: "thread-3", id: "busy", onId: async () => {} } }).answer()).rejects.toThrow(/open in another Muse Code/);
  });
});

describe("sessions", () => {
  it("keeps the thread's process between turns and resumes in a new one", async () => {
    await scenario({});
    await turn().answer();
    await turn({ session: { key: "thread-1", id: "session-1", onId: async () => {} } }).answer();
    expect(await calls("initialize")).toHaveLength(1);
    expect(await calls("session/resume")).toHaveLength(0);
    disposeMuse();
    await turn({ session: { key: "thread-1", id: "session-1", onId: async () => {} } }).answer();
    expect((await calls("session/resume")).map((m) => m.params.sessionId)).toEqual(["session-1"]);
    // A resumed conversation already heard Relay's instructions.
    expect((await calls("turn/start")).at(-1)!.params.input[0].text).not.toMatch(/^Help the requesting user/);
  });

  it("forks for a side question, read-only", async () => {
    await scenario({});
    await turn({ job: { kind: "side" }, session: { key: "side-1", fork: { thread: "session-1", at: "" }, onId: async () => {} } }).answer();
    const [fork] = await calls("session/fork");
    expect(fork!.params.sessionId).toBe("session-1");
    expect((await calls("session/setPermissionProfile"))[0]!.params.profileId).toBe(":read-only");
  });
});

describe("subagents", () => {
  it("shows a subagent's calls under its row", async () => {
    await scenario({
      turn: [{ subagent: { objective: "Check the tests", result: "All pass", child: { tool: "read_file", args: { path: "a.test.ts" } } } }, { text: "Done." }],
    });
    const { heard, answer } = turn();
    await answer();
    const rows = [...heard.activity.values()];
    const agent = rows.find((r) => r.kind === "agent")!;
    expect(agent).toMatchObject({ label: "Check the tests", status: "complete", detail: "All pass" });
    expect(rows.find((r) => r.kind === "read")).toMatchObject({ label: "a.test.ts", parentId: agent.id });
  });
});

describe("catalog", () => {
  it("lists Muse's models with their efforts and default", async () => {
    await scenario({
      models: [
        {
          modelId: "muse-wonder-full-1.0",
          displayLabel: "Muse Wonder Full",
          description: "Frontier",
          isDefault: true,
          contextLimit: 1048576,
          defaultReasoningEffort: "high",
          variants: ["low", "medium", "high", "xhigh", "max", "ultra"],
        },
        { modelId: "muse-spark-1.3", displayLabel: "Muse Spark 1.3", description: null, isDefault: false, variants: { kind: "unknown" } },
        // The live server labels this one with its own id.
        { modelId: "muse-wonder-1.0", displayLabel: "muse-wonder-1.0", description: null, isDefault: false, variants: { kind: "unknown" } },
      ],
    });
    await expect(museModels()).resolves.toEqual([
      {
        id: "muse-wonder-full-1.0",
        name: "Muse Wonder Full",
        description: "Frontier",
        efforts: ["low", "medium", "high", "xhigh", "max", "ultra"],
        defaultEffort: "high",
        contextWindow: 1048576,
      },
      { id: "muse-spark-1.3", name: "Muse Spark 1.3", description: "", efforts: [] },
      { id: "muse-wonder-1.0", name: "Muse Wonder 1.0", description: "", efforts: [] },
    ]);
    await expect(museDefaults()).resolves.toMatchObject({ model: "muse-wonder-full-1.0", effort: "high" });
  });
});
