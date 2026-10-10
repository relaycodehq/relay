import {
  copyFile,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "esbuild";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { AgentHosts, type ProcessReader } from "../../agent-host/client";
import type { Entry } from "../../agent-host/protocol";
import {
  acquireCursorConnection,
  closeCursorConnection,
  detachCursor,
  reattachCursorSessions,
} from "./connection";
import { hostAgents } from "../hosted-sessions";
import { runCursor } from "./run";
import { configureCursor } from "./sdk";
import type { InstalledSdk } from "./sdk-install";
import type { AgentOptions } from "../types";

// A Cursor turn keeps running in the agent host while Relay restarts, and the
// next Relay picks it up, whether it's still working or finished meanwhile.

let root: string;
let log: string;
const opened: AgentHosts[] = [];

beforeAll(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "relay-cursor-host-")));
  const banner =
    'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);';
  await build({
    entryPoints: ["electron/agent-host/host.ts"],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: join(root, "agent-host.mjs"),
    logLevel: "error",
    banner: { js: banner },
  });
  await build({
    entryPoints: ["electron/agents/cursor/worker.ts"],
    bundle: true,
    platform: "node",
    target: "node22",
    format: "esm",
    outfile: join(root, "worker.mjs"),
    logLevel: "error",
  });
  const sdk = join(root, "sdk");
  const pkg = join(sdk, "1.0.32/node_modules/@cursor/sdk");
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
    join(sdk, "current.json"),
    JSON.stringify({ version: "1.0.32" }),
  );
  configureCursor({
    worker: join(root, "worker.mjs"),
    root: sdk,
    store: join(root, "store"),
    fetch: async () => {
      throw new Error("The tests have no network.");
    },
  });
  log = join(root, "fake.jsonl");
  process.env.CURSOR_FAKE_LOG = log;
});

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

afterEach(async () => {
  delete process.env.CURSOR_FAKE_RELEASE;
  delete process.env.CURSOR_FAKE_CLOSED;
  await closeCursorConnection("thread-1");
  detachCursor();
  for (const hosts of opened.splice(0)) hosts.detach();
  const dir = join(root, "hosts");
  for (const name of await readdir(dir).catch(() => [] as string[])) {
    const pid = /^host-(\d+)\.json$/.exec(name)?.[1];
    if (!pid) continue;
    try {
      process.kill(Number(pid), "SIGTERM");
    } catch {}
    await expect.poll(() => alive(Number(pid))).toBe(false);
  }
  await rm(dir, { recursive: true, force: true });
  await writeFile(log, "");
});
afterAll(async () => {
  delete process.env.CURSOR_FAKE_LOG;
  await rm(root, { recursive: true, force: true });
});

/** A Relay that started: its own connection to the host. */
function newRelay() {
  // The last Relay is gone: it lets go of the host, which keeps its workers running.
  for (const last of opened) last.detach();
  detachCursor();
  const hosts = new AgentHosts(
    join(root, "hosts"),
    join(root, "agent-host.mjs"),
  );
  opened.push(hosts);
  hostAgents(hosts);
  return hosts;
}

function threadTurn(extra: Partial<AgentOptions> = {}) {
  const seen = { text: [] as string[], ids: [] as string[] };
  let partOne!: () => void;
  const working = new Promise<void>((resolve) => (partOne = resolve));
  const options: AgentOptions = {
    job: { kind: "prompt" },
    cwd: root,
    prompt: "[[linger]]",
    choice: { model: "", fast: false, reasoningEffort: "" },
    signal: new AbortController().signal,
    onText: (text) => {
      seen.text.push(text);
      if (text.includes("part one")) partOne();
    },
    session: { key: "thread-1", onId: async (id) => void seen.ids.push(id) },
    ...extra,
  };
  return { seen, options, working };
}

const sentMessages = async () =>
  (await readFile(log, "utf8"))
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));

it("carries on a turn Relay restarted in, and shows the whole answer", async () => {
  const release = join(root, "continue-turn");
  process.env.CURSOR_FAKE_RELEASE = release;
  newRelay();
  const first = threadTurn();
  const orphan = runCursor(first.options);
  orphan.catch(() => {});
  await first.working;

  // Relay restarts: its host connection goes, the host and the worker stay.
  const before = (await sentMessages())[0].pid;
  newRelay();
  const back = await reattachCursorSessions((key) => key === "thread-1");
  expect(back).toEqual([{ key: "thread-1", open: true }]);

  const second = threadTurn({
    job: { kind: "adopt" },
    session: { key: "thread-1", id: first.seen.ids[0], onId: async () => {} },
  });
  const continued = runCursor(second.options);
  await writeFile(release, "");
  expect(await continued).toBe("part one part two");
  expect(second.seen.text.at(-1)).toBe("part one part two");
  // Still the worker the first Relay started, not a new one.
  expect((await sentMessages()).map((m) => m.pid)).toEqual([before]);
});

it("hands over a turn that finished while Relay was away", async () => {
  const release = join(root, "finish-turn");
  process.env.CURSOR_FAKE_RELEASE = release;
  newRelay();
  const first = threadTurn();
  const orphan = runCursor(first.options);
  orphan.catch(() => {});
  await first.working;

  const observer = newRelay();
  await writeFile(release, "");
  // Observe the host's actual reply without letting Cursor adopt or finish the turn.
  const [found] = await observer.discover();
  const reply = new Promise<void>((resolve) => {
    const check = (entry: Entry) => {
      if (entry.kind !== "line") return;
      const message = JSON.parse(entry.text);
      if (message.result?.text === "part one part two") resolve();
    };
    found.attachProcess().read({
      replayed: (entries) => entries.forEach(check),
      entry: check,
    });
  });
  await reply;
  newRelay();
  const back = await reattachCursorSessions((key) => key === "thread-1");
  expect(back).toEqual([{ key: "thread-1", open: true }]);

  const second = threadTurn({
    job: { kind: "adopt" },
    session: { key: "thread-1", id: first.seen.ids[0], onId: async () => {} },
  });
  expect(await runCursor(second.options)).toBe("part one part two");
});

it("lets a thread that isn't Relay's go, and keeps the next turn on the same agent", async () => {
  newRelay();
  const first = threadTurn({ prompt: "say hello" });
  expect(await runCursor(first.options)).toBe("Hello");
  const second = threadTurn({
    prompt: "say hello again",
    session: { key: "thread-1", id: first.seen.ids[0], onId: async () => {} },
  });
  await runCursor(second.options);
  const [one, two] = await sentMessages();
  // The same worker and the same agent answered both turns.
  expect(two.pid).toBe(one.pid);
  expect(two.agent).toBe(one.agent);

  newRelay();
  expect(await reattachCursorSessions(() => false)).toEqual([]);
});

it("lets a worker in the host close its agents when its thread's session ends", async () => {
  const closed = join(root, "closed.log");
  await writeFile(closed, "");
  process.env.CURSOR_FAKE_CLOSED = closed;
  newRelay();
  const turn = threadTurn({ prompt: "say hello" });
  expect(await runCursor(turn.options)).toBe("Hello");
  await closeCursorConnection("thread-1");
  // Told to stop by its input closing, not killed before it gets to.
  await expect.poll(() => readFile(closed, "utf8")).toContain(turn.seen.ids[0]);
});

it("numbers a picked-up worker's requests above the replies its log still holds", async () => {
  let reader!: ProcessReader;
  const written: { id: number }[] = [];
  const hosted = {
    read: (r: ProcessReader) => (reader = r),
    write: (line: string) => written.push(JSON.parse(line)),
    mark: () => {},
    keep: () => {},
    close: () => {},
  };
  const found = {
    info: {
      id: "s",
      key: "thread-1",
      kind: "process",
      meta: { provider: "cursor", run: { run: "r", id: 1 } },
      split: 0,
      open: true,
    },
    attachProcess: () => hosted,
    close: vi.fn(),
  };
  hostAgents({ discover: async () => [found] } as unknown as AgentHosts);
  await reattachCursorSessions((key) => key === "thread-1");
  const connection = await acquireCursorConnection(
    "thread-1",
    root,
    {} as InstalledSdk,
  );

  // The last Relay steered and cancelled; the worker answered both.
  const entry = (seq: number, kind: "line" | "input", value: unknown) => ({
    seq,
    kind,
    text: JSON.stringify(value),
  });
  reader.replayed!([
    entry(0, "input", { id: 1, method: "run", params: {} }),
    entry(1, "input", { id: 2, method: "steer", params: {} }),
    entry(2, "line", { id: 2, result: null }),
    entry(3, "input", { id: 3, method: "cancel", params: {} }),
    entry(4, "line", { id: 3, result: null }),
  ]);
  connection.resume();

  const steered = connection.request("steer", { run: "r", text: "go on" });
  expect(written.map((m) => m.id)).toEqual([4]);
  reader.entry({
    seq: 5,
    kind: "line",
    text: JSON.stringify({ id: 4, result: "taken" }),
  });
  expect(await steered).toBe("taken");
});
