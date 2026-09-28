import { it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { findExecutable } from "../../electron/executables";
import { runOpenCode } from "../../electron/agents/opencode/run";
import { disposeOpenCode } from "../../electron/agents/opencode/client";
import { permissionRules } from "../../electron/agents/opencode/permissions";
import { openCodeModels } from "../../electron/agents/opencode/catalog";
import { runtimeModes } from "../../shared/agent-modes";
import type { AgentOptions } from "../../electron/agents/types";
import { fakeCli } from "../fixtures/fake-cli";
vi.mock("../../electron/executables", async (actual) => ({
  ...(await actual<typeof import("../../electron/executables")>()),
  findExecutable: vi.fn(),
}));

let root: string;
beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "relay-opencode-")));
  const cli = await fakeCli(
    join(root, "opencode"),
    await readFile(resolve("tests/fixtures/opencode-server.cjs"), "utf8"),
  );
  vi.mocked(findExecutable).mockResolvedValue(cli);
  vi.stubEnv("RELAY_OPENCODE_CAPTURE", join(root, "capture.jsonl"));
});
afterEach(async () => {
  disposeOpenCode();
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});
const captured = async () =>
  (await readFile(join(root, "capture.jsonl"), "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
function turn(prompt: string, extra: Partial<AgentOptions> = {}) {
  const seen = {
    texts: [] as string[],
    commentary: new Map<string, string | null>(),
    activity: [] as string[],
    edits: new Set<string>(),
    context: 0,
    requests: [] as string[],
    session: undefined as string | undefined,
    point: undefined as string | undefined,
  };
  const options: AgentOptions = {
    cwd: root,
    prompt,
    choice: { model: "zen/pickle", reasoningEffort: "high", fast: false },
    signal: new AbortController().signal,
    runtimeMode: "approval-required",
    interactionMode: "default",
    onText: (text) => seen.texts.push(text),
    onCommentary: (id, text) => seen.commentary.set(id, text),
    onActivity: (a) => seen.activity.push(`${a.kind}:${a.status}:${a.label}`),
    onEdit: (paths) => paths.forEach((p) => seen.edits.add(p)),
    onContext: (usage) => (seen.context = usage.usedTokens),
    onRequest: async (request) => {
      seen.requests.push(`${request.title} ${request.detail}`);
      return { kind: "approval", decision: "accept" };
    },
    session: {
      key: "k",
      onId: async (id) => {
        seen.session = id;
      },
      onPoint: (at) => (seen.point = at),
    },
    ...extra,
  };
  return { seen, run: runOpenCode(options) };
}

it("runs a turn: commentary before a tool, the ask, the edit and the answer", async () => {
  const { seen, run } = turn("Write notes.md");
  expect(await run).toBe("Wrote notes.md.");
  // Text written before the tool call moved out of the answer into commentary.
  expect([...seen.commentary.values()]).toContain("Let me check.");
  expect(seen.texts).toContain("Let me check.");
  expect(seen.texts.at(-1)).toBe("Wrote notes.md.");
  expect(seen.requests).toEqual(["Allow these file changes? +hello"]);
  expect(seen.activity).toContain(`file:complete:${root}/notes.md`);
  expect([...seen.edits]).toEqual([`${root}/notes.md`]);
  expect(seen.context).toBe(1500);
  expect(seen.session).toMatch(/^ses_/);
  expect(seen.point).toMatch(/^msg_/);
  const calls = await captured();
  const created = calls.find(
    (c) => c.path === "/session" && c.method === "POST",
  );
  expect(created.directory).toBe(root);
  // Supervised asks before edits and commands.
  expect(created.body.permission).toContainEqual({
    permission: "edit",
    pattern: "*",
    action: "ask",
  });
  const prompt = calls.find((c) => c.path.endsWith("/prompt_async"));
  expect(prompt.body).toMatchObject({
    agent: "build",
    model: { providerID: "zen", modelID: "pickle" },
    variant: "high",
    parts: [{ type: "text", text: "Write notes.md" }],
  });
  expect(calls.find((c) => c.path.startsWith("/permission/")).body).toEqual({
    reply: "once",
  });
});

it("rejects the ask when the user declines", async () => {
  const { run } = turn("Write notes.md", {
    onRequest: async () => ({ kind: "approval", decision: "decline" }),
  });
  expect(await run).toBe("Skipped the edit.");
  const calls = await captured();
  expect(calls.find((c) => c.path.startsWith("/permission/")).body).toEqual({
    reply: "reject",
  });
});

it("resumes its session, and a fork starts after the answer it was cut at", async () => {
  const first = turn("Write notes.md");
  await first.run;
  const resumed = turn("Again", {
    session: { key: "k", id: first.seen.session, onId: async () => {} },
  });
  await resumed.run;
  let forked = "";
  const fork = turn("On the side", {
    session: {
      key: "k2",
      fork: { thread: first.seen.session!, at: first.seen.point! },
      onId: async (id) => {
        forked = id;
      },
    },
  });
  await fork.run;
  expect(forked).not.toBe(first.seen.session);
  const calls = await captured();
  expect(
    calls.filter((c) => c.path === "/session" && c.method === "POST"),
  ).toHaveLength(1);
  const cut = calls.find((c) => c.path.endsWith("/fork"));
  // The first message of the resumed turn is where the fork cuts.
  expect(cut.body.messageID).toMatch(/^msg_/);
  expect(cut.body.messageID).not.toBe(first.seen.point);
});

it("stops when aborted", async () => {
  const abort = new AbortController();
  const { run } = turn("abort please", { signal: abort.signal });
  // Stopped mid-turn, once OpenCode has the prompt.
  await vi.waitFor(async () =>
    expect(
      (await captured()).some((c) => c.path.endsWith("/prompt_async")),
    ).toBe(true),
  );
  abort.abort();
  await expect(run).rejects.toThrow("Cancelled by you.");
  expect((await captured()).some((c) => c.path.endsWith("/abort"))).toBe(true);
});

it("never strips bash from a session, which Zen's free models refuse", () => {
  const all = [
    ...runtimeModes.map((m) => permissionRules(m.value, {})),
    permissionRules(undefined, {}),
    permissionRules("full-access", { readOnly: true }),
    permissionRules(undefined, { title: true }),
  ];
  for (const rules of all) {
    // The last rule for every command decides; a later allow or ask for
    // some commands keeps the tool offered too.
    const last = rules
      .map(
        (r) =>
          (r.permission === "bash" || r.permission === "*") &&
          r.pattern === "*",
      )
      .lastIndexOf(true);
    const stripped =
      rules[last].action === "deny" &&
      !rules
        .slice(last + 1)
        .some((r) => r.permission === "bash" && r.action !== "deny");
    expect(stripped).toBe(false);
  }
  const reviewer = permissionRules("full-access", { readOnly: true });
  expect(reviewer.filter((r) => r.permission === "edit").at(-1)?.action).toBe(
    "deny",
  );
});

it("lists the signed-in providers' models, leaving Anthropic's to Relay's Claude", async () => {
  expect((await openCodeModels()).map((m) => m.id)).toEqual(["zen/pickle"]);
});
