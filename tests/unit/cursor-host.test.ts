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
import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import { AgentHosts } from "../../electron/agent-host/client";
import {
  closeCursorConnection,
  detachCursor,
  reattachCursorSessions,
} from "../../electron/agents/cursor/connection";
import { hostAgents } from "../../electron/agents/hosted-sessions";
import { runCursor } from "../../electron/agents/cursor/run";
import { configureCursor } from "../../electron/agents/cursor/sdk";
import type { AgentOptions } from "../../electron/agents/types";

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
  delete process.env.CURSOR_FAKE_LINGER;
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
  const options: AgentOptions = {
    cwd: root,
    prompt: "[[linger]]",
    choice: { model: "", fast: false, reasoningEffort: "" },
    signal: new AbortController().signal,
    onText: (text) => seen.text.push(text),
    session: { key: "thread-1", onId: async (id) => void seen.ids.push(id) },
    ...extra,
  };
  return { seen, options };
}

const sentMessages = async () =>
  (await readFile(log, "utf8"))
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));

async function untilText(seen: { text: string[] }, wanted: string) {
  await expect
    .poll(() => seen.text.at(-1) ?? "", { timeout: 10_000 })
    .toContain(wanted);
}

it("carries on a turn Relay restarted in, and shows the whole answer", async () => {
  process.env.CURSOR_FAKE_LINGER = "2500";
  newRelay();
  const first = threadTurn();
  const orphan = runCursor(first.options);
  orphan.catch(() => {});
  await untilText(first.seen, "part one");

  // Relay restarts: its host connection goes, the host and the worker stay.
  const before = (await sentMessages())[0].pid;
  newRelay();
  const back = await reattachCursorSessions((key) => key === "thread-1");
  expect(back).toEqual([{ key: "thread-1", open: true }]);

  const second = threadTurn({
    adopt: true,
    session: { key: "thread-1", id: first.seen.ids[0], onId: async () => {} },
  });
  expect(await runCursor(second.options)).toBe("part one part two");
  expect(second.seen.text.at(-1)).toBe("part one part two");
  // Still the worker the first Relay started, not a new one.
  expect((await sentMessages()).map((m) => m.pid)).toEqual([before]);
});

it("hands over a turn that finished while Relay was away", async () => {
  process.env.CURSOR_FAKE_LINGER = "300";
  newRelay();
  const first = threadTurn();
  const orphan = runCursor(first.options);
  orphan.catch(() => {});
  await untilText(first.seen, "part one");

  newRelay();
  // Long enough for the worker to finish with nobody listening.
  await new Promise((resolve) => setTimeout(resolve, 1200));
  const back = await reattachCursorSessions((key) => key === "thread-1");
  expect(back).toEqual([{ key: "thread-1", open: true }]);

  const second = threadTurn({
    adopt: true,
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
  await expect
    .poll(() => readFile(closed, "utf8"), { timeout: 5000 })
    .toContain(turn.seen.ids[0]);
});
