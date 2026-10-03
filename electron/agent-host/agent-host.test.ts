import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import { build } from "esbuild";
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
import { AgentHosts, type HostedQuery } from "./client";
import { codexReplay } from "../agents/codex/codex-connection";

// A Claude Code stand-in that asks to run a command before it answers, and
// says what it was told. It logs its pid so the test can see it end.
const cli = `#!${process.execPath}
const { appendFileSync } = require("node:fs");
appendFileSync(process.env.FAKE_LOG, process.pid + "\\n");
let n = 0;
const emit = (v) => process.stdout.write(JSON.stringify({ uuid: "f" + ++n, session_id: "fake", ...v }) + "\\n");
require("node:readline").createInterface({ input: process.stdin }).on("line", (line) => {
  const m = JSON.parse(line);
  if (m.type === "control_request")
    return emit({ type: "control_response", response: { subtype: "success", request_id: m.request_id, response: {} } });
  if (m.type === "control_response" && m.response.request_id === "ask-1") {
    const text = "Told: " + m.response.response.behavior;
    emit({ type: "assistant", parent_tool_use_id: null, message: { id: "a", role: "assistant", content: [{ type: "text", text }], usage: {} } });
    return emit({ type: "result", subtype: "success", is_error: false, result: text, duration_ms: 1, duration_api_ms: 1, num_turns: 1, total_cost_usd: 0, usage: {}, modelUsage: {}, permission_denials: [] });
  }
  if (m.type === "user")
    emit({ type: "control_request", request_id: "ask-1", request: { subtype: "can_use_tool", tool_name: "Bash", input: { command: "ls" }, tool_use_id: "t1" } });
}).on("close", () => process.exit(0));
`;

let root: string, script: string, claude: string, log: string;
const opened: AgentHosts[] = [];
beforeAll(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "relay-agent-host-")));
  script = join(root, "agent-host.mjs");
  await build({
    entryPoints: ["electron/agent-host/host.ts"],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: script,
    logLevel: "error",
    banner: {
      js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);',
    },
  });
  claude = join(root, "claude");
  await writeFile(claude, cli, { mode: 0o700 });
});
afterEach(async () => {
  for (const hosts of opened.splice(0)) hosts.detach();
  // Each test's hosts end with it.
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
});
afterAll(() => rm(root, { recursive: true, force: true }));

const hostsFor = () => {
  const hosts = new AgentHosts(join(root, "hosts"), script);
  opened.push(hosts);
  return hosts;
};
const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
async function open(hosts: AgentHosts, canUseTool: () => Promise<unknown>) {
  log = join(root, `claude-${Date.now()}.log`);
  const query = await hosts.open({
    key: "thread",
    meta: { note: "kept" },
    options: {
      cwd: root,
      pathToClaudeCodeExecutable: claude,
      env: { ...process.env, FAKE_LOG: log },
    },
    hooks: {},
    handlers: { canUseTool: async () => canUseTool(), hooks: {} },
  });
  query.mark("start");
  query.push({
    type: "user",
    session_id: "",
    parent_tool_use_id: null,
    message: { role: "user", content: "List the files" },
  });
  return query;
}
async function answerOf(query: HostedQuery) {
  for await (const frame of query)
    if (frame.type === "result") return frame.result as string;
}

it("asks again, after a restart, what Claude asked while Relay was away", async () => {
  let asked!: () => void;
  const wasAsked = new Promise<void>((r) => (asked = r));
  const first = hostsFor();
  // Relay goes away with the question unanswered.
  await open(first, () => {
    asked();
    return new Promise(() => {});
  });
  await wasAsked;
  first.detach();

  const [found] = await hostsFor().discover();
  expect(found.info).toMatchObject({ key: "thread", open: true });
  expect(found.info.meta).toEqual({ note: "kept" });
  const query = found.attach({
    canUseTool: async () => ({ behavior: "allow", updatedInput: {} }),
    hooks: {},
  });
  expect(await answerOf(query)).toBe("Told: allow");
}, 20_000);

it("ends a session Relay closes, and its Claude Code with it", async () => {
  const hosts = hostsFor();
  const query = await open(hosts, async () => ({
    behavior: "allow",
    updatedInput: {},
  }));
  expect(await answerOf(query)).toBe("Told: allow");
  const pid = Number((await readFile(log, "utf8")).trim());
  expect(alive(pid)).toBe(true);
  query.close();
  await expect.poll(() => alive(pid), { timeout: 5000 }).toBe(false);
}, 20_000);

it("gives a process back after a restart with what it said meanwhile, and keeps it running", async () => {
  // Echoes each line it's given, and ticks while nobody writes.
  const script = `
    let n = 0;
    setInterval(() => console.log("tick " + ++n), 50);
    require("node:readline").createInterface({ input: process.stdin })
      .on("line", (line) => console.log(line.toUpperCase()));
  `;
  const first = hostsFor();
  const running = await first.openProcess({
    key: "server",
    meta: { provider: "fixture" },
    process: {
      command: process.execPath,
      args: ["-e", script],
      cwd: root,
      env: { ...process.env } as Record<string, string>,
      group: false,
    },
  });
  const heard = new Promise<void>((resolve) =>
    running.read({
      entry: (e) => {
        if (e.kind === "line" && e.text === "HELLO") resolve();
      },
    }),
  );
  running.mark("start", { turn: "thread" });
  running.write("hello");
  await heard;
  first.detach();

  const [found] = await hostsFor().discover();
  expect(found.info).toMatchObject({
    key: "server",
    kind: "process",
    meta: { provider: "fixture" },
  });
  expect(Object.keys(found.info.turns ?? {})).toEqual(["thread"]);
  const back = found.attachProcess();
  const replayed = await new Promise<string[]>((resolve) =>
    back.read({
      replayed: (entries) =>
        resolve(
          entries.flatMap((e) =>
            e.kind === "line" || e.kind === "input"
              ? [`${e.kind}:${e.text}`]
              : [],
          ),
        ),
      entry: () => {},
    }),
  );
  expect(replayed).toEqual(
    expect.arrayContaining(["input:hello", "line:HELLO"]),
  );
  const echoed = new Promise<void>((resolve) =>
    back.read({
      entry: (e) => {
        if (e.kind === "line" && e.text === "AGAIN") resolve();
      },
    }),
  );
  back.write("again");
  await echoed;
}, 20_000);

it("replays a cut-off Codex turn without the last Relay's replies or answered questions", () => {
  const line = (seq: number, value: unknown) =>
    ({ seq, kind: "line", text: JSON.stringify(value) }) as const;
  const entries = [
    line(0, { method: "turn/started", params: { turn: { id: "old" } } }),
    { seq: 1, kind: "mark", mark: "start", at: 2 } as const,
    line(2, { id: 1, result: { turn: { id: "t" } } }),
    line(3, { method: "turn/started", params: { turn: { id: "t" } } }),
    line(4, { id: 7, method: "item/commandExecution/requestApproval" }),
    {
      seq: 5,
      kind: "input",
      text: JSON.stringify({ id: 7, result: { decision: "accept" } }),
    } as const,
    line(6, { id: 8, method: "item/fileChange/requestApproval" }),
    line(7, { method: "item/agentMessage/delta", params: { delta: "Hi" } }),
    { seq: 8, kind: "line", text: "not json" } as const,
  ];
  expect(codexReplay(entries, 2).map((l) => JSON.parse(l))).toEqual([
    { method: "turn/started", params: { turn: { id: "t" } } },
    { id: 8, method: "item/fileChange/requestApproval" },
    { method: "item/agentMessage/delta", params: { delta: "Hi" } },
  ]);
});
