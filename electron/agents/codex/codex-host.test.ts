import {
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
import { AgentHosts } from "../../agent-host/client";
import { findExecutable } from "../../platform/executables";
import { fakeCli } from "../../../tests/fixtures/fake-cli";
import { hostAgents } from "../hosted-sessions";
import type { AgentOptions } from "../types";
import { runCodex } from "./codex";
import {
  closeCodexConnection,
  detachCodex,
  reattachCodexSessions,
} from "./codex-connection";

// A Codex turn keeps running in the agent host while Relay restarts, and the
// next Relay picks it up without sending it again.

vi.mock("../../platform/executables");

// `codex app-server` with one turn: "part one", then, once the release file
// exists, " and part two". Every request it reads goes to the log.
const appServer = (log: string, release: string) => `
const { appendFileSync, existsSync } = require("node:fs");
const send = (v) => process.stdout.write(JSON.stringify(v) + "\\n");
const on = (method, params) => send({ method, params: { threadId: "thread", ...params } });
require("node:readline").createInterface({ input: process.stdin }).on("line", (line) => {
  const m = JSON.parse(line);
  appendFileSync(${JSON.stringify(log)}, JSON.stringify({ method: m.method }) + "\\n");
  if (m.method === "initialize") send({ id: m.id, result: {} });
  else if (m.method === "config/read") send({ id: m.id, result: { config: {} } });
  else if (m.method === "thread/start")
    send({ id: m.id, result: { thread: { id: "thread" }, model: "gpt-6-astra", reasoningEffort: "xhigh" } });
  else if (m.method === "turn/start") {
    send({ id: m.id, result: { turn: { id: "turn" } } });
    on("turn/started", { turn: { id: "turn" } });
    on("item/started", { item: { id: "a", type: "agentMessage" } });
    on("item/agentMessage/delta", { itemId: "a", delta: "part one" });
    const wait = setInterval(() => {
      if (!existsSync(${JSON.stringify(release)})) return;
      clearInterval(wait);
      on("item/agentMessage/delta", { itemId: "a", delta: " and part two" });
      on("item/completed", {
        item: { id: "a", type: "agentMessage", phase: "final_answer", text: "part one and part two" },
      });
      on("turn/completed", { turn: { id: "turn", status: "completed" } });
    }, 20);
  } else if (m.id !== undefined) send({ id: m.id, result: {} });
});
`;

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

let root = "";
let log = "";
let release = "";
const opened: AgentHosts[] = [];

beforeAll(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "relay-codex-host-")));
  await build({
    entryPoints: ["electron/agent-host/host.ts"],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: join(root, "agent-host.mjs"),
    logLevel: "error",
    banner: {
      js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);',
    },
  });
  log = join(root, "sent.jsonl");
  release = join(root, "release");
  vi.mocked(findExecutable).mockResolvedValue(
    await fakeCli(join(root, "codex"), appServer(log, release)),
  );
});

afterEach(async () => {
  await closeCodexConnection("thread-1");
  detachCodex();
  hostAgents(undefined);
  for (const hosts of opened.splice(0)) hosts.detach();
  for (const name of await readdir(join(root, "hosts")).catch(
    () => [] as string[],
  )) {
    const pid = /^host-(\d+)\.json$/.exec(name)?.[1];
    if (!pid) continue;
    try {
      process.kill(Number(pid), "SIGTERM");
    } catch {}
    await expect.poll(() => alive(Number(pid))).toBe(false);
  }
  await rm(join(root, "hosts"), { recursive: true, force: true });
  await rm(log, { force: true });
  await rm(release, { force: true });
});

afterAll(() => rm(root, { recursive: true, force: true }));

/** A Relay that started: its own connection to the host. */
function newRelay() {
  for (const last of opened) last.detach();
  detachCodex();
  const hosts = new AgentHosts(
    join(root, "hosts"),
    join(root, "agent-host.mjs"),
  );
  opened.push(hosts);
  hostAgents(hosts);
  return hosts;
}

function threadTurn(extra: Partial<AgentOptions> = {}) {
  const seen = { text: "", ids: [] as string[] };
  let partOne!: () => void;
  const working = new Promise<void>((resolve) => (partOne = resolve));
  const options: AgentOptions = {
    job: { kind: "prompt" },
    cwd: root,
    prompt: "Go",
    choice: { model: "", fast: false, reasoningEffort: "" },
    runtimeMode: "full-access",
    interactionMode: "default",
    signal: new AbortController().signal,
    onText: (text) => {
      seen.text = text;
      if (text.includes("part one")) partOne();
    },
    session: { key: "thread-1", onId: async (id) => void seen.ids.push(id) },
    ...extra,
  };
  return { seen, options, working };
}

const sent = async () =>
  (await readFile(log, "utf8").catch(() => ""))
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line).method as string);

it("carries on a turn Relay restarted in, and shows the whole answer", async () => {
  newRelay();
  const first = threadTurn();
  runCodex(first.options).catch(() => {});
  await first.working;

  // Relay restarts: its host connection goes, the host and `codex app-server` stay.
  newRelay();
  expect(await reattachCodexSessions((key) => key === "thread-1")).toEqual([
    { key: "thread-1", open: true },
  ]);
  const second = threadTurn({
    job: { kind: "adopt" },
    session: { key: "thread-1", id: first.seen.ids[0], onId: async () => {} },
  });
  const continued = runCodex(second.options);
  // What it said while nobody listened comes through first.
  await second.working;
  await writeFile(release, "");
  await expect(continued).resolves.toBe("part one and part two");
  // Picked up, not sent again.
  expect((await sent()).filter((m) => m === "turn/start")).toHaveLength(1);

  // The next turn goes on in the same process and thread.
  const third = threadTurn({
    session: { key: "thread-1", id: first.seen.ids[0], onId: async () => {} },
  });
  await expect(runCodex(third.options)).resolves.toBe("part one and part two");
  const after = await sent();
  expect(after.filter((m) => m === "turn/start")).toHaveLength(2);
  expect(after.filter((m) => m === "initialize")).toHaveLength(1);
  expect(after.filter((m) => m === "thread/resume")).toHaveLength(0);
});

it("lets a thread that isn't Relay's go", async () => {
  await writeFile(release, "");
  newRelay();
  await runCodex(threadTurn().options);
  newRelay();
  expect(await reattachCodexSessions(() => false)).toEqual([]);
});

it("can't adopt a thread whose server never started one", async () => {
  newRelay();
  await expect(
    runCodex(
      threadTurn({
        job: { kind: "adopt" },
        session: { key: "thread-1", onId: async () => {} },
      }).options,
    ),
  ).rejects.toThrow("Codex has no turn of its own to show.");
});
