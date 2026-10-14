import {
  access,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "esbuild";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { forgetCursorModels, cursorDefaults, cursorModels } from "./catalog";
import { closeCursorConnection } from "./connection";
import { cursorPolicy, runCursor } from "./run";
import { configureCursor } from "./sdk";
import { runtimeModesFor } from "../../../shared/agent-modes";
import type { AgentOptions } from "../types";
import type { AgentActivity } from "../../../shared/projects";
import {
  relayToken,
  serveRelayTools,
  toolText,
  verifyRelayToken,
} from "../../relay-mcp";

let dir: string;
let log: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "relay-cursor-run-"));
  const worker = join(dir, "worker.mjs");
  await build({
    entryPoints: ["electron/agents/cursor/worker.ts"],
    bundle: true,
    platform: "node",
    target: "node22",
    format: "esm",
    outfile: worker,
    logLevel: "silent",
  });
  // Where the installer puts a downloaded SDK; this one is the fixture's.
  const root = join(dir, "sdk");
  const pkg = join(root, "1.0.32/node_modules/@cursor/sdk");
  await mkdir(join(pkg, "dist/esm"), { recursive: true });
  await copyFile(
    "tests/fixtures/cursor-sdk.mjs",
    join(pkg, "dist/esm/index.js"),
  );
  await writeFile(
    join(pkg, "package.json"),
    JSON.stringify({ name: "@cursor/sdk", version: "1.0.32", type: "module" }),
  );
  await writeFile(
    join(root, "current.json"),
    JSON.stringify({ version: "1.0.32" }),
  );
  configureCursor({
    worker,
    root,
    store: join(dir, "store"),
    fetch: async () => {
      throw new Error("The tests have no network.");
    },
  });
  log = join(dir, "fake.jsonl");
  process.env.CURSOR_FAKE_LOG = log;
});

beforeEach(async () => {
  await writeFile(log, "");
  forgetCursorModels();
});
afterEach(() => {
  delete process.env.CURSOR_FAKE_SIGNED_OUT;
});
afterAll(async () => {
  delete process.env.CURSOR_FAKE_LOG;
  await rm(dir, { recursive: true, force: true });
});

/** What the fake SDK was asked, one entry per message sent. */
const asked = async () =>
  (await readFile(log, "utf8"))
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));

function turn(prompt: string, extra: Partial<AgentOptions> = {}) {
  const seen = {
    text: [] as string[],
    commentary: new Map<string, string | null>(),
    activity: [] as AgentActivity[],
    edits: [] as string[][],
    plans: [] as string[],
    ids: [] as string[],
    steered: [] as string[],
  };
  const controller = new AbortController();
  const options: AgentOptions = {
    job: { kind: "prompt" },
    cwd: dir,
    prompt,
    choice: { model: "", fast: false, reasoningEffort: "" },
    signal: controller.signal,
    onText: (text) => seen.text.push(text),
    onCommentary: (id, text) => void seen.commentary.set(id, text),
    onActivity: (activity) => seen.activity.push(activity),
    onEdit: (paths) => seen.edits.push(paths),
    onPlan: (plan) => seen.plans.push(plan),
    onSteered: (id) => seen.steered.push(id),
    session: { onId: async (id) => void seen.ids.push(id) },
    ...extra,
  };
  return { seen, controller, options };
}

describe("a Cursor turn", () => {
  it("streams the answer and remembers the agent for the thread", async () => {
    const { seen, options } = turn("say hello");
    expect(await runCursor(options)).toBe("Hello");
    expect(seen.text.at(-1)).toBe("Hello");
    expect(seen.ids).toHaveLength(1);
    const [sent] = await asked();
    // No model picked: Cursor's own Auto, and no limits in Full access.
    expect(sent.sendOptions).toEqual({ model: { id: "auto" }, mode: "agent" });
    // The project's and the user's own Cursor rules, MCP servers and hooks apply.
    expect(sent.options.local.settingSources).toEqual([
      "project",
      "user",
      "plugins",
    ]);
    expect(sent.options.local.sandboxOptions).toBeUndefined();
    expect(sent.options.local.autoReview).toBeUndefined();
  });

  it("keeps each thread's agents in a store of its own, since the SDK's store only locks within one worker", async () => {
    const thread = (key: string) =>
      turn("say hello", { session: { key, onId: async () => {} } }).options;
    try {
      await Promise.all([runCursor(thread("a")), runCursor(thread("b"))]);
      const stores = (await asked()).map(
        (sent) => sent.options.local.store.dir,
      );
      expect(new Set(stores).size).toBe(2);
      for (const store of stores)
        expect(store).toContain(join("store", "threads"));
    } finally {
      await closeCursorConnection("a");
      await closeCursorConnection("b");
    }
  });

  it("names tool calls by what they touched, and calls what came before them commentary", async () => {
    const { seen, options } = turn("[[tools]]");
    expect(await runCursor(options)).toBe("Done.");
    expect(seen.commentary.get("cursor-0")).toBe("Let me look. ");
    expect(seen.text.at(-1)).toBe("Done.");
    const shell = seen.activity.filter((a) => a.id === "c1");
    expect(shell.map((a) => a.status)).toEqual(["running", "complete"]);
    expect(shell.at(-1)).toMatchObject({
      kind: "command",
      label: "ls src",
      detail: "a.ts\nb.ts\n",
    });
    expect(seen.activity.at(-1)).toMatchObject({
      kind: "file",
      label: "src/a.ts",
      status: "complete",
    });
    expect(seen.edits.flat()).toEqual(["src/a.ts", "src/a.ts"]);
  });

  it("asks for a plan in Plan mode and reports the one Cursor writes", async () => {
    const { seen, options } = turn("[[plan]]", { interactionMode: "plan" });
    await runCursor(options);
    expect((await asked())[0].sendOptions.mode).toBe("plan");
    expect(seen.plans).toContain("1. Do it");
  });

  it("sends effort and explicit Standard even when Grok defaults to Fast", async () => {
    const { options } = turn("say hello", {
      choice: { model: "grok-4.7", fast: false, reasoningEffort: "high" },
    });
    await runCursor(options);
    expect((await asked())[0].sendOptions.model).toEqual({
      id: "grok-4.7",
      params: [
        { id: "reasoning_effort", value: "high" },
        { id: "fast", value: "false" },
      ],
    });
  });

  it.each([true, false])(
    "sends explicit Fast=%s for a model with no effort levels",
    async (fast) => {
      const { options } = turn("say hello", {
        choice: { model: "composer-2.5", fast, reasoningEffort: "" },
      });
      await runCursor(options);
      const [sent] = await asked();
      const model = {
        id: "composer-2.5",
        params: [{ id: "fast", value: String(fast) }],
      };
      expect(sent.options.model).toEqual(model);
      expect(sent.sendOptions.model).toEqual(model);
    },
  );

  it("switches Fast on and off in a warm session while keeping effort", async () => {
    let id: string | undefined;
    const session = {
      key: "cursor-fast-switch",
      onId: async (next: string) => {
        id = next;
      },
    };
    try {
      for (const fast of [false, true, false]) {
        await runCursor(
          turn("say hello", {
            session: { ...session, id },
            choice: { model: "grok-4.7", fast, reasoningEffort: "high" },
          }).options,
        );
      }
      const sent = await asked();
      expect(new Set(sent.map((s) => s.agent)).size).toBe(1);
      expect(sent.map((s) => s.sendOptions.model.params)).toEqual(
        [false, true, false].map((fast) => [
          { id: "reasoning_effort", value: "high" },
          { id: "fast", value: String(fast) },
        ]),
      );
    } finally {
      await closeCursorConnection(session.key);
    }
  });

  it("refuses Fast on a model that does not offer it instead of silently running Standard", async () => {
    await expect(
      runCursor(
        turn("say hello", {
          choice: { model: "auto", fast: true, reasoningEffort: "" },
        }).options,
      ),
    ).rejects.toThrow("Auto does not offer Fast mode");
    expect(await asked()).toEqual([]);
  });

  it("sends images along and starts a new agent when Cursor forgot the old one", async () => {
    const picture = join(dir, "shot.png");
    await writeFile(picture, "png");
    const { seen, options } = turn("look at this", {
      images: [{ path: picture, mimeType: "image/png" }],
      session: { id: "agent-gone", onId: async (id) => void seen.ids.push(id) },
    });
    await runCursor(options);
    expect((await asked())[0].images).toBe(1);
    expect(seen.ids).toHaveLength(1);
    expect(seen.ids[0]).not.toBe("agent-gone");
  });

  it("stops when cancelled", async () => {
    let started!: () => void;
    const ready = new Promise<void>((resolve) => (started = resolve));
    const { controller, options } = turn("[[slow]]", {
      onText: () => started(),
    });
    const running = runCursor(options);
    const cancelled = expect(running).rejects.toThrow(/Cancelled by you/);
    await ready;
    controller.abort();
    await cancelled;
  });

  it("ends a worker whose turn ignores Stop, so the thread's next turn resumes its agent instead of finding it busy", async () => {
    const alive = (pid: number) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    };
    const ids: string[] = [];
    const session = {
      key: "stuck-thread",
      onId: async (id: string) => void ids.push(id),
    };
    let started!: () => void;
    const ready = new Promise<void>((resolve) => (started = resolve));
    const stuck = turn("[[stuck]] review the pull request", {
      session,
      onActivity: () => started(),
    });
    try {
      const running = runCursor(stuck.options);
      const stopped = expect(running).rejects.toThrow(/Cancelled by you/);
      await ready;
      stuck.controller.abort();
      await stopped;
      const [first] = await asked();
      // Not left in a kept worker, running beside the next turn.
      await vi.waitFor(() => expect(alive(first.pid)).toBe(false));

      const next = turn("say hello", {
        session: { ...session, id: ids.at(-1) },
      });
      expect(await runCursor(next.options)).toBe("Hello");
      const sent = await asked();
      expect(sent.some((entry) => entry.expired)).toBe(true);
      const resumed = sent.filter((entry) => entry.prompt).at(-1);
      expect(resumed.agent).toBe(first.agent);
      expect(resumed.pid).not.toBe(first.pid);
    } finally {
      await closeCursorConnection("stuck-thread");
    }
  }, 30_000);

  it("takes a steering message while it works and answers it", async () => {
    let steer!: NonNullable<
      Parameters<NonNullable<AgentOptions["onControl"]>>[0]
    >["steer"];
    let working!: () => void;
    const ready = new Promise<void>((resolve) => (working = resolve));
    const { seen, options } = turn("[[steer]]", {
      onControl: (control) => (steer = control.steer),
      onText: (text) => {
        seen.text.push(text);
        if (text === "Working. ") working();
      },
    });
    const running = runCursor(options);
    await ready;
    await steer("switch to b", "m1");
    expect(await running).toBe("Got: switch to b");
    expect(seen.steered).toEqual(["m1"]);
  });

  it("stops an answer that grows past the size limit, like the other agents", async () => {
    const { controller, options } = turn("[[flood]]");
    await expect(runCursor(options)).rejects.toThrow(
      "Answer size limit reached.",
    );
    expect(controller.signal.aborted).toBe(false);
  });

  it("says what went wrong when Cursor fails", async () => {
    await expect(runCursor(turn("[[fail]]").options)).rejects.toThrow(
      "The model is down.",
    );
  });

  it("points at Settings when Cursor isn't signed in, and says so as a sign-in error", async () => {
    process.env.CURSOR_FAKE_SIGNED_OUT = "1";
    const error = await runCursor(turn("say hello").options).catch((e) => e);
    expect(error.message).toMatch(/isn't signed in.*Settings/);
    expect(error).toMatchObject({ kind: "signedOut", provider: "cursor" });
  });

  it("points at Settings when Cursor rejects the key", async () => {
    const error = await runCursor(turn("[[auth]]").options).catch((e) => e);
    expect(error.message).toMatch(/isn't signed in.*Settings/);
    expect(error).toMatchObject({ kind: "signedOut", provider: "cursor" });
  });

  it("says a rate or usage limit is one, keeping Cursor's reason and promising no reset", async () => {
    const error = await runCursor(turn("[[ratelimit]]").options).catch(
      (e) => e,
    );
    expect(error).toMatchObject({ kind: "usageLimit", provider: "cursor" });
    expect(error.message).toContain("You've hit your Cursor usage limit.");
    expect(error.resetsAt).toBeUndefined();
  });

  it("says a run that ends in error with a sign-in code is a sign-in error", async () => {
    for (const code of [
      "NOT_LOGGED_IN",
      "AUTH_TOKEN_EXPIRED",
      "unauthenticated",
    ]) {
      const error = await runCursor(turn(`[[runerror:${code}]]`).options).catch(
        (e) => e,
      );
      expect(error, code).toMatchObject({
        kind: "signedOut",
        provider: "cursor",
      });
    }
  });

  it("says a run that ends in error with a rate or usage limit code is one, keeping Cursor's reason", async () => {
    for (const code of [
      "PRO_USER_USAGE_LIMIT",
      "RATE_LIMITED",
      "resource_exhausted",
    ]) {
      const error = await runCursor(turn(`[[runerror:${code}]]`).options).catch(
        (e) => e,
      );
      expect(error, code).toMatchObject({
        kind: "usageLimit",
        provider: "cursor",
      });
      expect(error.message).toContain("The run stopped.");
      expect(error.resetsAt).toBeUndefined();
    }
  });

  it("leaves a run that ends in error with another or no code as Cursor's own words", async () => {
    for (const code of ["internal", "none"]) {
      const error = await runCursor(turn(`[[runerror:${code}]]`).options).catch(
        (e) => e,
      );
      expect(error, code).not.toHaveProperty("kind");
      expect(error.message).toBe("The run stopped.");
    }
  });

  it("leaves an error that only sounds like signing in as Cursor's own words", async () => {
    const error = await runCursor(turn("[[apikey]]").options).catch((e) => e);
    expect(error).not.toHaveProperty("kind");
  });

  it("passes on Cursor's own words when an error only sounds like signing in", async () => {
    await expect(runCursor(turn("[[apikey]]").options)).rejects.toThrow(
      "The MCP server docs needs an API key in its settings.",
    );
  });

  it("won't compact by hand, since Cursor summarizes on its own", async () => {
    await expect(
      runCursor(turn("x", { job: { kind: "compact" } }).options),
    ).rejects.toThrow(/on its own/);
  });
});

describe("Relay's own tools", () => {
  const secret = "b".repeat(64);
  const calls: { chatId: string; name: string }[] = [];
  let url: string;
  let close: () => Promise<void>;
  beforeAll(async () => {
    const serving = serveRelayTools(0, {
      verify: (token) => verifyRelayToken(secret, token),
      call: async (chatId, name) => {
        calls.push({ chatId, name });
        return toolText("No started threads.");
      },
    });
    await serving.ready;
    close = serving.close;
    const { port } = serving.server.address() as { port: number };
    url = `http://127.0.0.1:${port}/mcp`;
  });
  afterAll(() => close());
  beforeEach(() => void (calls.length = 0));

  const relayTools = () => ({ url, token: relayToken(secret, "chat-1") });

  it("reach Cursor as its own tools, called as the thread without asking even in Supervised, and read like the other agents'", async () => {
    const { seen, options } = turn("[[relay]]", {
      relayTools: relayTools(),
      runtimeMode: "approval-required",
    });
    expect(await runCursor(options)).toBe("No started threads.");
    expect(calls).toEqual([{ chatId: "chat-1", name: "list_threads" }]);
    const [sent] = await asked();
    expect(sent.sendOptions.customTools).toEqual(
      expect.arrayContaining(["start_threads", "list_threads", "show_html"]),
    );
    expect(seen.activity.at(-1)).toMatchObject({
      kind: "tool",
      label: "Checked on started threads",
      status: "complete",
      mcp: { server: "relay", tool: "list_threads" },
    });
  });

  it("aren't given to a read-only reviewer or a helper job", async () => {
    await runCursor(
      turn("[[relay]]", { relayTools: relayTools(), readOnly: true }).options,
    );
    await runCursor(
      turn("[[relay]]", {
        relayTools: relayTools(),
        job: { kind: "helper", instructions: "Answer briefly." },
      }).options,
    );
    expect((await asked()).map((sent) => sent.sendOptions.customTools)).toEqual(
      [undefined, undefined],
    );
    expect(calls).toEqual([]);
  });
});

describe("a helper job", () => {
  it("is one bare question: no tools, none of the user's Cursor settings, its own instructions, and nothing left behind", async () => {
    const { seen, options } = turn("Name this thread", {
      job: { kind: "helper", instructions: "Answer with a title only." },
      session: undefined,
    });
    await runCursor(options);
    const [sent] = await asked();
    expect(sent.options.tools).toEqual([]);
    expect(sent.options.systemPrompt).toBe("Answer with a title only.");
    expect(sent.options.local.settingSources).toBeUndefined();
    expect(sent.options.local.sandboxOptions).toEqual({ enabled: true });
    expect(seen.ids).toEqual([]);
    // Its history lives in a store of its own, gone once the worker is.
    const store = sent.options.local.store.dir;
    expect(store).toContain("tmp-");
    await expect
      .poll(() =>
        access(store).then(
          () => true,
          () => false,
        ),
      )
      .toBe(false);
  });

  it("never resumes the thread's agent or reads the thread's notes", async () => {
    const { options } = turn("Name this thread", {
      job: { kind: "helper", instructions: "Title only." },
      session: { id: "agent-1", onId: async () => {} },
      context: async () => "PRIVATE NOTE",
    });
    await runCursor(options);
    const [sent] = await asked();
    expect(sent.prompt).not.toContain("PRIVATE NOTE");
    expect(sent.agent).not.toBe("agent-1");
  });
});

describe("what Cursor may do", () => {
  it("can only be limited, not asked, so each approval mode maps to a limit", async () => {
    expect(cursorPolicy({ runtimeMode: "full-access" })).toEqual({
      sandbox: false,
      autoReview: false,
    });
    expect(cursorPolicy({ runtimeMode: "auto" })).toEqual({
      sandbox: false,
      autoReview: true,
    });
    expect(cursorPolicy({ runtimeMode: "auto-accept-edits" })).toEqual({
      sandbox: true,
      autoReview: false,
    });
    expect(cursorPolicy({ runtimeMode: "approval-required" })).toEqual({
      sandbox: true,
      autoReview: true,
    });
  });

  it("tells the truth in the composer: Cursor can't ask, the others keep their wording", () => {
    const cursorNotes = runtimeModesFor("cursor").map((m) => m.description);
    expect(cursorNotes.join(" ")).not.toMatch(/ask before/i);
    expect(
      runtimeModesFor("cursor").find((m) => m.value === "approval-required")
        ?.description,
    ).toMatch(/can't ask/);
    // Full access says the same wherever it runs, and other agents are untouched.
    expect(runtimeModesFor("cursor").at(-1)).toEqual(
      runtimeModesFor("codex").at(-1),
    );
    expect(runtimeModesFor("codex")).toEqual(runtimeModesFor());
    expect(runtimeModesFor("codex")[0].description).toMatch(
      /^Asks before running commands/,
    );
  });

  it("gives a read-only turn no shell and no edits at all", async () => {
    const { tools, sandbox } = cursorPolicy({
      readOnly: true,
      runtimeMode: "full-access",
    });
    expect(sandbox).toBe(true);
    expect(tools).toContain("read");
    for (const forbidden of ["shell", "edit", "write", "delete", "mcp"])
      expect(tools).not.toContain(forbidden);

    const { options } = turn("say hello", { readOnly: true });
    await runCursor(options);
    expect((await asked())[0].options.tools).toEqual(tools);
  });

  it("passes the limit on to the SDK", async () => {
    await runCursor(
      turn("say hello", { runtimeMode: "approval-required" }).options,
    );
    const [{ options }] = await asked();
    expect(options.local.sandboxOptions).toEqual({ enabled: true });
    expect(options.local.autoReview).toBe(true);
  });
});

describe("Cursor's models", () => {
  it("lists them with the effort levels they name, and defaults to Auto", async () => {
    const models = await cursorModels();
    expect(models.find((m) => m.id === "composer-2.5")).toMatchObject({
      name: "Composer 2.5",
      efforts: [],
      fast: true,
    });
    expect(models.find((m) => m.id === "grok-4.7")).toMatchObject({
      efforts: ["low", "high"],
      defaultEffort: "high",
      fast: true,
    });
    expect(models.find((m) => m.id === "claude-opus-fixture")).toMatchObject({
      efforts: ["low", "high"],
      defaultEffort: "high",
      fast: false,
    });
    expect(models.find((m) => m.id === "auto")?.fast).toBe(false);
    expect(models.find((m) => m.id === "auto")?.efforts).toEqual([]);
    expect(await cursorDefaults()).toEqual({ model: "auto", effort: "" });
  });
});

// Last in the file: Relay remembers for the rest of the process that Cursor can't sandbox.
describe("where Cursor can't sandbox", () => {
  beforeEach(() => {
    process.env.CURSOR_FAKE_NO_SANDBOX = "1";
  });
  afterEach(() => {
    delete process.env.CURSOR_FAKE_NO_SANDBOX;
  });

  it("goes on read-only without the sandbox, with the same tools, and says so", async () => {
    const { seen, options } = turn("say hello", { readOnly: true });
    expect(await runCursor(options)).toBe("Hello");
    const [refused, sent] = await asked();
    expect(refused.options.local.sandboxOptions).toEqual({ enabled: true });
    expect(sent.options.local.sandboxOptions).toBeUndefined();
    expect(sent.options.tools).toEqual(cursorPolicy({ readOnly: true }).tools);
    expect(seen.commentary.get("cursor-sandbox")).toMatch(
      /can't sandbox.*read-only tools/,
    );
    // Only the agent that answered is the thread's.
    expect(seen.ids).toEqual([sent.agent]);
    expect(seen.text.at(-1)).toBe("Hello");
  });

  it("remembers it, so the next read-only turn and helper job skip the refusal", async () => {
    const { seen, options } = turn("say hello", { readOnly: true });
    expect(await runCursor(options)).toBe("Hello");
    await runCursor(
      turn("Name this thread", {
        job: { kind: "helper", instructions: "Title only." },
        session: undefined,
      }).options,
    );
    const sent = await asked();
    expect(sent).toHaveLength(2);
    for (const { options } of sent)
      expect(options.local.sandboxOptions).toBeUndefined();
    expect(seen.commentary.get("cursor-sandbox")).toMatch(/can't sandbox/);
  });

  it("won't drop the sandbox from a turn that may edit, and says why it can't run", async () => {
    const { seen, options } = turn("say hello", {
      runtimeMode: "approval-required",
    });
    const failed = runCursor(options);
    await expect(failed).rejects.toThrow(
      /can't sandbox on this system.*Supervised or Auto-accept edits/,
    );
    await expect(failed).rejects.not.toThrow(/signed in/);
    const sent = await asked();
    expect(sent).toHaveLength(1);
    expect(sent[0].options.local.sandboxOptions).toEqual({ enabled: true });
    expect(seen.ids).toEqual([]);
  });
});
