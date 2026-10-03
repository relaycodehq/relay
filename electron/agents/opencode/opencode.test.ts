import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { findExecutable } from "../../platform/executables";
import { runOpenCode } from "./run";
import { disposeOpenCode } from "./client";
import { permissionRules } from "./permissions";
import { openCodeCommands, openCodeDefaults, openCodeModels } from "./catalog";
import { readOpenRouterCredit } from "../openrouter-credit";
import { runtimeModes } from "../../../shared/agent-modes";
import type { AgentOptions } from "../types";
import { fakeCli } from "../../../tests/fixtures/fake-cli";
vi.mock("../../platform/executables", async (actual) => ({
  ...(await actual<typeof import("../../platform/executables")>()),
  findExecutable: vi.fn(),
}));
const held = vi.hoisted(() => ({
  path: "",
  release: undefined as Promise<void> | undefined,
}));
// Holds back the read of one file, so a test can end a turn while it is read.
vi.mock("node:fs/promises", async (actual) => {
  const fs = await actual<typeof import("node:fs/promises")>();
  return {
    ...fs,
    readFile: (async (path: string, ...rest: unknown[]) => {
      if (path === held.path) await held.release;
      return (fs.readFile as (...a: unknown[]) => unknown)(path, ...rest);
    }) as typeof fs.readFile,
  };
});

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
    cost: 0,
    requests: [] as string[],
    session: undefined as string | undefined,
    point: undefined as string | undefined,
  };
  const options: AgentOptions = {
    job: { kind: "prompt" },
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
    onCost: (usd) => (seen.cost += usd),
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
  // Each step counted once, at its latest price.
  expect(seen.cost).toBeCloseTo(0.037);
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

describe("what OpenCode sends", () => {
  const quirky = (quirk: string, prompt = "Write notes.md") => {
    vi.stubEnv("RELAY_OPENCODE_QUIRK", quirk);
    return turn(prompt);
  };

  it("fails the turn naming the field when a message part arrives without its message", async () => {
    // It used to end as a complete answer with an empty body.
    await expect(quirky("part-without-messageID").run).rejects.toThrow(
      /OpenCode sent an unexpected message\.part\.updated event \(part\.messageID/,
    );
  });

  it("fails the turn when a text delta has no text", async () => {
    await expect(quirky("delta-without-text").run).rejects.toThrow(
      /unexpected message\.part\.delta event \(delta/,
    );
  });

  it("fails the turn when the stored messages have no ids", async () => {
    await expect(quirky("message-without-id").run).rejects.toThrow(
      /unexpected session message list response \(0\.info\.id/,
    );
  });

  it("ignores events and part types it doesn't read, and fields it doesn't know", async () => {
    const { run } = quirky("newer");
    expect(await run).toBe("Wrote notes.md.");
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

it("turns a steer away when the turn ends while its screenshot is read", async () => {
  const shot = join(root, "shot.png");
  await writeFile(shot, "png");
  held.path = shot;
  let open!: () => void;
  held.release = new Promise((resolve) => (open = resolve));
  let steering: Promise<string> | undefined;
  const { run } = turn("Write notes.md", {
    onControl: (control) => {
      steering = control
        .steer("And this", "msg-2", [{ path: shot, mimeType: "image/png" }])
        .then(
          () => "sent",
          (e: Error) => e.message,
        );
    },
  });
  try {
    await run;
    open();
    // Turned away, it stays queued and goes out as a turn of its own.
    expect(await steering).toBe(
      "This turn has finished. Send the queued message as a new turn.",
    );
    const prompts = (await captured()).filter((c) =>
      c.path.endsWith("/prompt_async"),
    );
    expect(prompts).toHaveLength(1);
  } finally {
    open();
    held.path = "";
  }
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

/** What the turn ends in when OpenCode fails it with `error`, announced or only stored. */
const failsWith = (error: object, stored = false) =>
  turn(
    `Write notes.md fixture ${stored ? "stored " : ""}error: ${JSON.stringify(error)}`,
  ).run.catch((e) => e);
const apiError = (statusCode: number, extra: object = {}) => ({
  name: "APIError",
  data: {
    message: "Provider said no.",
    statusCode,
    isRetryable: false,
    ...extra,
  },
});

it("ends a turn OpenCode has no login for as signed out, naming the provider", async () => {
  const auth = {
    name: "ProviderAuthError",
    data: { providerID: "openrouter", message: "Authentication failed" },
  };
  for (const stored of [false, true])
    expect(await failsWith(auth, stored)).toMatchObject({
      kind: "signedOut",
      provider: "opencode",
      message: expect.stringContaining("openrouter"),
    });
  expect(await failsWith(apiError(401))).toMatchObject({ kind: "signedOut" });
  // A 403 can be the model or the region; it says nothing about the login.
  expect(await failsWith(apiError(403))).not.toHaveProperty("kind");
});

it("ends a turn the provider refused for rate or credit as a usage limit, with a reset only when it says one", async () => {
  const limited = await failsWith(
    apiError(429, { responseHeaders: { "Retry-After": "120" } }),
  );
  expect(limited).toMatchObject({ kind: "usageLimit", provider: "opencode" });
  expect(limited.message).toContain("Provider said no.");
  expect(limited.resetsAt - Date.now()).toBeGreaterThan(110_000);
  expect(limited.resetsAt - Date.now()).toBeLessThanOrEqual(120_000);
  const spent = await failsWith(
    apiError(402, { message: "Insufficient credits" }),
    true,
  );
  expect(spent).toMatchObject({ kind: "usageLimit" });
  expect(spent.message).toContain("Insufficient credits");
  expect(spent.resetsAt).toBeUndefined();
  expect((await failsWith(apiError(429))).resetsAt).toBeUndefined();
});

it("leaves any other failure as OpenCode's own words", async () => {
  const error = await failsWith(apiError(500, { message: "Upstream broke." }));
  expect(error).not.toHaveProperty("kind");
  expect(error.message).toBe("Upstream broke.");
  expect(await failsWith({ name: "UnknownError", data: {} })).toHaveProperty(
    "message",
    "UnknownError",
  );
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

describe("what OpenCode lists and configures", () => {
  beforeEach(() => openCodeModels.forget());

  it("reads the default model and the commands of a project", async () => {
    expect(await openCodeDefaults(root)).toEqual({
      model: "zen/pickle",
      effort: "",
    });
    expect(await openCodeCommands(root)).toEqual([
      {
        name: "init",
        source: "other",
        description: "Create AGENTS.md",
      },
    ]);
  });

  it.each([
    [
      "provider-list-without-all",
      () => openCodeModels(),
      "provider list response (all",
    ],
    [
      "model-without-id",
      () => openCodeModels(),
      "zen provider response (models.pickle.id",
    ],
    ["config-not-an-object", () => openCodeDefaults(root), "config response"],
    [
      "command-without-name",
      () => openCodeCommands(root),
      "command list response (0.name",
    ],
  ])(
    "fails %s naming what's wrong instead of carrying on with undefined",
    async (quirk, call, message) => {
      vi.stubEnv("RELAY_OPENCODE_QUIRK", quirk);
      await expect(call()).rejects.toThrow(
        `OpenCode sent an unexpected ${message}`,
      );
    },
  );

  it("says so when OpenCode lists its providers in a shape this Relay can't read, rather than that it has no key", async () => {
    vi.stubEnv("RELAY_OPENCODE_QUIRK", "providers-not-a-list");
    expect(await readOpenRouterCredit(true)).toMatchObject({
      balance: null,
      message: expect.stringContaining(
        "OpenCode sent an unexpected provider config response (providers",
      ),
    });
  });

  it("says OpenCode has no OpenRouter key when none of its providers has one", async () => {
    expect(await readOpenRouterCredit(true)).toMatchObject({
      message: "OpenCode has no OpenRouter key",
    });
  });
});
