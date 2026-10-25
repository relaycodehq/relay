// Records what the real agent CLIs say in each scenario, for replay-agent.cjs.
// Spends a little real usage, so it never runs with the unit tests:
//
//   RELAY_RECORD=claude,codex npx vitest run -c tests/record/vitest.config.ts
//
// Every agent runs in a throwaway project with an empty config folder (only
// the sign-in comes along), so no instructions, MCP servers or skills of
// yours end up in a transcript. Raw transcripts land in
// $RELAY_RECORD_OUT (default /tmp/relay-replays-raw); `node
// tests/record/redact.mjs` redacts them into tests/fixtures/replays.
import { execFileSync } from "node:child_process";
import { mkdir, readFile, rm, stat, symlink } from "node:fs/promises";
import { createServer, type AddressInfo } from "node:net";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, it, vi } from "vitest";
import { findExecutable } from "../../electron/platform/executables";
import { fakeCli } from "../fixtures/fake-cli";
import { openCodeRecordingProxy } from "./opencode-proxy";
import {
  recordedChoice,
  startScenario,
  type Scenario,
} from "../fixtures/turn-scenario";
import type { AgentProvider } from "../../shared/projects";

vi.mock("../../electron/platform/executables");

vi.mock("../../electron/agents/antigravity/install", async (original) => ({
  ...(await original<object>()),
  ...(await import("../fixtures/antigravity-stand-in")).antigravityStandIn,
}));

const agents = (process.env.RELAY_RECORD ?? "").split(",").filter(Boolean);
const rawRoot = process.env.RELAY_RECORD_OUT ?? "/tmp/relay-replays-raw";
const which = (name: string) =>
  execFileSync("/bin/sh", ["-lc", `command -v ${name}`], {
    encoding: "utf8",
  }).trim();

/** Starts a scenario whose `provider` CLI is the real one behind replay-tee. */
async function recording(provider: AgentProvider, scenario: string) {
  const out = join(rawRoot, provider, scenario);
  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });
  const real =
    provider === "antigravity"
      ? (await installedAntigravityHere()).command
      : which(provider);
  // Antigravity's --version prints its build machine; its folder's version says enough.
  const version =
    provider === "antigravity"
      ? (await installedAntigravityHere()).version
      : execFileSync(real, ["--version"], { encoding: "utf8" }).trim();
  // One per agent for the whole run: Codex's processes race to set up a
  // fresh folder's database, so it's set up once before the first scenario.
  const clean = join(rawRoot, ".config", provider);
  const fresh = !(await stat(clean).catch(() => null));
  await mkdir(clean, { recursive: true });
  const env: Record<string, string> = {};
  if (provider === "claude") {
    env.CLAUDE_CONFIG_DIR = clean;
    // Empty: Claude Code reads the usual Keychain sign-in, never a copy of it.
    env.CLAUDE_SECURESTORAGE_CONFIG_DIR = "";
  }
  if (provider === "codex") {
    env.CODEX_HOME = clean;
    if (fresh) {
      await symlink(
        join(homedir(), ".codex", "auth.json"),
        join(clean, "auth.json"),
      );
      execFileSync(real, ["app-server"], {
        env: { ...process.env, CODEX_HOME: clean },
        input:
          JSON.stringify({
            id: 1,
            method: "initialize",
            params: { clientInfo: { name: "relay-record", version: "1" } },
          }) + "\n",
        timeout: 15_000,
      });
    }
  }
  if (provider === "muse") {
    // Muse keeps its sign-in with its settings and its sessions under data.
    env.XDG_CONFIG_HOME = clean;
    env.XDG_DATA_HOME = join(clean, "data");
    env.XDG_STATE_HOME = join(clean, "state");
    if (fresh) {
      await mkdir(join(clean, "muse"), { recursive: true });
      await symlink(
        join(homedir(), ".config", "muse", "auth.json"),
        join(clean, "muse", "auth.json"),
      );
    }
  }
  if (provider === "antigravity") {
    // Its sign-in: the token file (or the Keychain item, read as is) and which kind it is.
    env.GEMINI_HOME = clean;
    if (fresh) {
      await mkdir(join(clean, "antigravity-acp"), { recursive: true });
      for (const file of ["acp_token.json", "settings.json"])
        await symlink(
          join(homedir(), ".gemini", "antigravity-acp", file),
          join(clean, "antigravity-acp", file),
        ).catch(() => {});
    }
  }
  let proxy: Awaited<ReturnType<typeof openCodeRecordingProxy>> | undefined;
  if (provider === "opencode") {
    env.XDG_CONFIG_HOME = clean;
    env.OPENCODE_CONFIG_DIR = clean;
    // Its sessions go here too, not into the person's own OpenCode history,
    // and its service is its own, not the one the person's OpenCode runs.
    env.XDG_DATA_HOME = join(clean, "data");
    env.XDG_STATE_HOME = join(clean, "state");
    // The service listens on one fixed port; the person's own is on the default.
    execFileSync(real, ["service", "set", "port", String(await freePort())], {
      env: { ...process.env, ...env },
      timeout: 30_000,
    });
    proxy = await openCodeRecordingProxy(out);
    stops.push(async () => {
      await proxy!.close();
      try {
        execFileSync(real, ["service", "stop"], {
          env: { ...process.env, ...env },
          timeout: 30_000,
        });
      } catch {
        // Not started.
      }
    });
    if (fresh) {
      await mkdir(join(clean, "data", "opencode"), { recursive: true });
      await symlink(
        join(homedir(), ".local", "share", "opencode", "auth.json"),
        join(clean, "data", "opencode", "auth.json"),
      );
    }
  }
  const s = await startScenario({
    findExecutable: vi.mocked(findExecutable),
    env,
    // A real model takes its time over a tool call.
    waitMs: 240_000,
  });
  const tee = await readFile(resolve("tests/fixtures/replay-tee.cjs"), "utf8");
  const cli = await fakeCli(
    join(s.root, `${provider}-tee`),
    `process.env.RELAY_REPLAY_AGENT = ${JSON.stringify(provider)};\n` +
      `process.env.RELAY_REPLAY_REAL = ${JSON.stringify(real)};\n` +
      `process.env.RELAY_REPLAY_OUT = ${JSON.stringify(out)};\n` +
      `process.env.RELAY_REPLAY_VERSION = ${JSON.stringify(version)};\n` +
      (proxy
        ? `process.env.RELAY_REPLAY_PROXY = ${JSON.stringify(proxy.url)};\n`
        : "") +
      tee,
    version,
  );
  vi.mocked(findExecutable).mockImplementation(async (name: string) =>
    name === provider ? cli : which(name),
  );
  return s;
}

/** The Antigravity server Relay downloaded on this computer. */
async function installedAntigravityHere() {
  const root = join(
    homedir(),
    "Library",
    "Application Support",
    process.env.RELAY_RECORD_APP ?? "Relay Experimental",
    "antigravity",
  );
  const { version, cmd } = JSON.parse(
    await readFile(join(root, "current.json"), "utf8"),
  ) as { version: string; cmd: string };
  return { version, command: join(root, version, cmd) };
}

const freePort = () =>
  new Promise<number>((done, fail) => {
    const server = createServer();
    server.on("error", fail);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      server.close(() => done(port));
    });
  });

let s: Scenario | undefined;
/** What a recording started beside its scenario, stopped after it. */
const stops: (() => Promise<void>)[] = [];

afterEach(async () => {
  await s?.dispose();
  s = undefined;
  for (const stop of stops.splice(0)) await stop();
});

for (const provider of agents as AgentProvider[]) {
  const send = (id: string, body: string, extra = {}) =>
    s!.send(id, body, provider, { choice: recordedChoice(provider), ...extra });

  describe(provider, () => {
    it("simple", async () => {
      s = await recording(provider, "simple");
      const id = await s.thread();
      await send(id, "Reply with exactly the word pong and nothing else.");
      await s.ended(id);
    });

    it("tool", async () => {
      s = await recording(provider, "tool");
      const id = await s.thread();
      await send(
        id,
        "Create a file named notes.txt in the current folder containing the word hello. Then reply with exactly: done",
      );
      await s.ended(id);
    });

    it("two-turns", async () => {
      s = await recording(provider, "two-turns");
      const id = await s.thread();
      await send(id, "Reply with exactly the word pong and nothing else.");
      await s.ended(id);
      await send(id, "Now reply with exactly the word ping and nothing else.");
      await s.ended(id);
    });

    it("stop", async () => {
      s = await recording(provider, "stop");
      const id = await s.thread();
      await send(
        id,
        'Run this shell command in the foreground and wait for it: python3 -c "import time; time.sleep(30)" . Then reply with exactly: finished',
      );
      await s.message(
        id,
        (m) =>
          m.role === "assistant" &&
          !!m.trace?.some(
            (e) =>
              e.kind === "activity" &&
              e.activity.kind === "command" &&
              e.activity.status === "running",
          ),
      );
      await s.chats.cancel(id);
      await s.ended(id);
    });
    if (provider === "claude")
      it("background", async () => {
        s = await recording(provider, "background");
        const id = await s.thread();
        await send(
          id,
          "Start this shell command as a background task (run_in_background): python3 -c \"import time; time.sleep(4); print('background-done')\" . Reply with exactly: started, and end your turn without waiting for it.",
        );
        // Claude Code starts a turn by itself once the task ends.
        await s.message(id, (m) => !!m.unprompted && m.status !== "streaming");
        await s.ended(id);
      });
  });
}
