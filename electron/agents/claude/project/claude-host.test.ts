import { mkdtemp, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "esbuild";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { AgentHosts } from "../../../agent-host/client";
import { findExecutable } from "../../../platform/executables";
import { fakeCli } from "../../../../tests/fixtures/fake-cli";
import { hostAgents } from "../../hosted-sessions";
import {
  closeClaudeSession,
  reattachClaudeSessions,
  sessions,
} from "./session";
import { runClaudeProject } from "./index";

// A Claude turn keeps running in the agent host while Relay restarts, and the
// next Relay shows the rest of it.

vi.mock("../../../platform/executables");

// Claude Code answering one prompt, cut short by a "now" steer the way 2.1.302
// writes it, then answering the steer once the release file exists.
const cli = (release: string) => `
const { existsSync } = require("node:fs");
let n = 0, prompt;
const emit = (v) => process.stdout.write(JSON.stringify({ uuid: "f" + ++n, session_id: "fake", ...v }) + "\\n");
const says = (id, text) => emit({ type: "assistant", parent_tool_use_id: null, message: { id, role: "assistant", content: [{ type: "text", text }], usage: {} } });
const result = (v) => emit({ type: "result", subtype: "success", is_error: false, result: "", duration_ms: 1, duration_api_ms: 1, num_turns: 1, total_cost_usd: 0, usage: {}, modelUsage: {}, permission_denials: [], ...v });
const lifecycle = (command_uuid, state) => emit({ type: "command_lifecycle", command_uuid, state });
require("node:readline").createInterface({ input: process.stdin }).on("line", (line) => {
  const m = JSON.parse(line);
  if (m.type === "control_request")
    return emit({ type: "control_response", response: { subtype: "success", request_id: m.request_id, response: {} } });
  if (m.type !== "user") return;
  if (!prompt) {
    prompt = m.uuid;
    lifecycle(prompt, "started");
    return says("m1", "Committing.");
  }
  lifecycle(m.uuid, "queued");
  result({ subtype: "error_during_execution", is_error: true, terminal_reason: "aborted_streaming", errors: ["[ede_diagnostic] result_type=user last_content_type=n/a stop_reason=null"] });
  lifecycle(prompt, "cancelled");
  lifecycle(m.uuid, "started");
  const wait = setInterval(() => {
    if (!existsSync(${JSON.stringify(release)})) return;
    clearInterval(wait);
    says("m2", "Committed.");
    result({ result: "Committed." });
  }, 20);
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
let release = "";
const opened: AgentHosts[] = [];

beforeAll(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "relay-claude-host-")));
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
  release = join(root, "release");
  vi.mocked(findExecutable).mockResolvedValue(
    await fakeCli(join(root, "claude"), cli(release)),
  );
});

afterEach(async () => {
  closeClaudeSession("thread-1");
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
  await rm(release, { force: true });
});
afterAll(() => rm(root, { recursive: true, force: true }));

/** A Relay that started: its own connection to the host. */
function newRelay() {
  for (const last of opened) last.detach();
  const hosts = new AgentHosts(
    join(root, "hosts"),
    join(root, "agent-host.mjs"),
  );
  opened.push(hosts);
  hostAgents(hosts);
  return hosts;
}

const turn = (patch: Partial<Parameters<typeof runClaudeProject>[0]> = {}) =>
  runClaudeProject({
    job: { kind: "prompt" },
    cwd: root,
    prompt: "Commit it.",
    choice: { model: "", fast: false, reasoningEffort: "" },
    model: "",
    effort: "",
    signal: new AbortController().signal,
    onText() {},
    session: { key: "thread-1", id: "fake", async onId() {} },
    ...patch,
  });

it("shows the answer to a steer after a restart, not the reply the steer cut short", async () => {
  newRelay();
  let steer!: (text: string, id?: string) => Promise<void>;
  let steered!: () => void;
  const answering = new Promise<void>((resolve) => (steered = resolve));
  const first = turn({
    onControl: (control) => (steer = control.steer),
    onText: (text) => {
      if (text === "Committing.") void steer("Yes", "msg-2");
    },
    onSteered: () => steered(),
  });
  await answering;

  // Relay restarts: its host connection goes, the host and Claude Code stay.
  // The old Relay's turn goes with its process; here it just stops mattering.
  void first.catch(() => {});
  sessions.delete("thread-1");
  newRelay();
  await reattachClaudeSessions(
    (key) => key === "thread-1",
    () => async () => {},
  );
  await writeFile(release, "");
  const texts: string[] = [];
  await expect(
    turn({ job: { kind: "adopt" }, onText: (text) => void texts.push(text) }),
  ).resolves.toBe("Committed.");
  expect(texts).not.toContain("Committing.");
});
