import { mkdtemp, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { build } from "esbuild";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { AgentHosts } from "../../agent-host/client";
import { findExecutable } from "../../platform/executables";
import { fakeCli } from "../../../tests/fixtures/fake-cli";
import { hostAgents } from "../hosted-sessions";
import type { AgentOptions } from "../types";
import { runMuse } from "./run";
import { closeMuseSession, detachMuse, reattachMuse } from "./sessions";

// A Muse turn keeps running in the agent host while Relay restarts, and the
// next Relay picks it up without sending it again.

vi.mock("../../platform/executables");

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
const opened: AgentHosts[] = [];

beforeAll(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "relay-muse-host-")));
  await build({
    entryPoints: ["electron/agent-host/host.ts"],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: join(root, "agent-host.mjs"),
    logLevel: "error",
    banner: { js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' },
  });
  log = join(root, "sent.jsonl");
  vi.stubEnv("RELAY_MUSE_LOG", log);
  vi.mocked(findExecutable).mockResolvedValue(
    await fakeCli(join(root, "muse"), await readFile(resolve("tests/fixtures/muse-serve.cjs"), "utf8")),
  );
});

afterEach(async () => {
  await closeMuseSession("thread-1");
  detachMuse();
  for (const hosts of opened.splice(0)) hosts.detach();
  for (const name of await readdir(join(root, "hosts")).catch(() => [] as string[])) {
    const pid = /^host-(\d+)\.json$/.exec(name)?.[1];
    if (!pid) continue;
    try {
      process.kill(Number(pid), "SIGTERM");
    } catch {}
    await expect.poll(() => alive(Number(pid))).toBe(false);
  }
  await rm(join(root, "hosts"), { recursive: true, force: true });
});
afterAll(() => vi.unstubAllEnvs());

/** A Relay that started: its own connection to the host. */
function newRelay() {
  for (const last of opened) last.detach();
  detachMuse();
  const hosts = new AgentHosts(join(root, "hosts"), join(root, "agent-host.mjs"));
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
    .map((line) => JSON.parse(line));

it("carries on a turn Relay restarted in, and shows the whole answer", async () => {
  const release = join(root, "release");
  vi.stubEnv(
    "RELAY_MUSE_SCENARIO",
    JSON.stringify({ turn: [{ text: "part one" }, { waitFile: release }, { text: "part two" }] }),
  );
  newRelay();
  const first = threadTurn();
  runMuse(first.options).catch(() => {});
  await first.working;

  // Relay restarts: its host connection goes, the host and `muse serve` stay.
  newRelay();
  expect(await reattachMuse((key) => key === "thread-1")).toEqual([{ key: "thread-1", open: true }]);
  const second = threadTurn({
    job: { kind: "adopt" },
    session: { key: "thread-1", id: first.seen.ids[0], onId: async () => {} },
  });
  const continued = runMuse(second.options);
  await writeFile(release, "");
  await expect(continued).resolves.toBe("part one\n\npart two");
  // Picked up, not sent again.
  const messages = await sent();
  expect(messages.filter((m) => m.method === "turn/start")).toHaveLength(1);
  expect(messages.filter((m) => m.method === "initialize")).toHaveLength(1);

  // The next turn goes on in the same process and session (which plays its script again).
  const third = threadTurn({ session: { key: "thread-1", id: first.seen.ids[0], onId: async () => {} } });
  await expect(runMuse(third.options)).resolves.toBe("part one\n\npart two");
  const after = await sent();
  expect(after.filter((m) => m.method === "turn/start")).toHaveLength(2);
  expect(after.filter((m) => m.method === "session/resume")).toHaveLength(0);
});

it("lets a thread that isn't Relay's go", async () => {
  vi.stubEnv("RELAY_MUSE_SCENARIO", JSON.stringify({}));
  newRelay();
  await runMuse(threadTurn().options);
  newRelay();
  expect(await reattachMuse(() => false)).toEqual([]);
});
