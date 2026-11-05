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
import { AgentHosts } from "./client";
import { HostedChild } from "./child";

let root: string, script: string;
const opened: AgentHosts[] = [];
/** Children a test started that its hosts may have left behind. */
const strays: number[] = [];

beforeAll(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "relay-host-client-")));
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
});

afterEach(async () => {
  for (const hosts of opened.splice(0)) hosts.detach();
  const dir = join(root, "hosts");
  const hostPids = (await readdir(dir).catch(() => [] as string[])).flatMap(
    (name) => /^host-(\d+)\.json$/.exec(name)?.[1] ?? [],
  );
  for (const pid of [...strays.splice(0), ...hostPids.map(Number)])
    try {
      process.kill(pid, "SIGKILL");
    } catch {}
  await rm(dir, { recursive: true, force: true });
});

afterAll(() => rm(root, { recursive: true, force: true }));

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const hostsFor = (hostScript = script) => {
  const hosts = new AgentHosts(join(root, "hosts"), hostScript);
  opened.push(hosts);
  return hosts;
};

/** A host that writes its record, then answers each connection with `serve`'s body. */
async function fakeHost(name: string, serve: string) {
  const fake = join(root, `${name}.mjs`);
  await writeFile(
    fake,
    `
    import { createServer } from "node:net";
    import { writeFileSync } from "node:fs";
    import { join } from "node:path";
    const dir = process.argv[process.argv.indexOf("--relay-agent-host") + 1];
    const socket = join(dir, "${name}.sock");
    createServer((s) => { ${serve} }).listen(socket, () =>
      writeFileSync(join(dir, "host-" + process.pid + ".json"), JSON.stringify({
        pid: process.pid, socket, token: "x", version: "v", protocol: 1, started: Date.now(),
      })),
    );
    setTimeout(() => process.exit(0), 10000);
  `,
  );
  return hostsFor(fake);
}

const server = {
  command: process.execPath,
  args: ["-e", 'console.log("up"); setInterval(() => {}, 1000);'],
  cwd: tmpdir(),
  env: { ...process.env } as Record<string, string>,
  group: false,
};

it("turns down a freshly started host that hangs up, without throwing in Relay", async () => {
  const hosts = await fakeHost("hangup", "s.destroy();");
  const uncaught: unknown[] = [];
  const onUncaught = (error: unknown) => uncaught.push(error);
  process.on("uncaughtException", onUncaught);
  try {
    await expect(hosts.ensure()).rejects.toThrow("closed the connection");
    await new Promise((r) => setTimeout(r, 100));
  } finally {
    process.off("uncaughtException", onUncaught);
  }
  expect(uncaught.map(String)).toEqual([]);
});

it("holds a tool call carried over a restart until Relay can answer it", async () => {
  // Like host.ts resendTools: a wait_for_threads call still waiting from the
  // last Relay goes to the new one as soon as it says hello.
  const answered = join(root, "answered.json");
  const hosts = await fakeHost(
    "carried-tool",
    `
    s.setEncoding("utf8");
    let rest = "";
    s.on("data", (chunk) => {
      rest += chunk;
      let i;
      while ((i = rest.indexOf("\\n")) >= 0) {
        const m = JSON.parse(rest.slice(0, i));
        rest = rest.slice(i + 1);
        if (m.t === "hello") {
          s.write(JSON.stringify({ t: "welcome", version: "v", pid: process.pid, sessions: [] }) + "\\n");
          s.write(JSON.stringify({ t: "tool", id: 1, chatId: "lead", name: "wait_for_threads", args: {} }) + "\\n");
        }
        if (m.t === "toolResult") writeFileSync(${JSON.stringify(answered)}, JSON.stringify(m.result));
      }
    });
    `,
  );
  // Relay reattaches its sessions, reaching the host, before it can answer.
  await hosts.ensure();
  await new Promise((r) => setTimeout(r, 200));
  hosts.tools = async () => ({
    content: [{ type: "text", text: "threads done" }],
  });

  await expect
    .poll(() => readFile(answered, "utf8").catch(() => ""))
    .toContain("threads done");
});

it("ends a process taken back from a host that has since died", async () => {
  const first = hostsFor();
  const running = await first.openProcess({
    key: "server",
    meta: { provider: "fixture" },
    process: server,
  });
  await new Promise<void>((resolve) =>
    running.read({ entry: (e) => e.kind === "line" && resolve() }),
  );
  strays.push((await running.pid())!);
  first.detach();

  const second = hostsFor();
  const [found] = await second.discover();
  const [hostPid] = second.pids();
  // The host crashes after Relay found its sessions, before it takes them back.
  process.kill(hostPid!, "SIGKILL");
  await expect.poll(() => second.pids()).toEqual([]);

  const child = new HostedChild(found!.attachProcess());
  const exited = new Promise<"exited">((resolve) =>
    child.on("exit", () => resolve("exited")),
  );
  child.release();
  const late = new Promise<"hung">((r) => setTimeout(() => r("hung"), 2000));
  expect(await Promise.race([exited, late])).toBe("exited");
});

/** Starts a process that ignores both SIGTERM and the end of its input. */
async function stubbornProcess(hosts: AgentHosts) {
  const running = await hosts.openProcess({
    key: "agent",
    meta: { provider: "fixture" },
    process: {
      ...server,
      args: [
        "-e",
        'process.on("SIGTERM", () => {}); process.stdin.resume(); console.log("up"); setInterval(() => {}, 1000);',
      ],
      stopByInput: true,
    },
  });
  await new Promise<void>((resolve) =>
    running.read({ entry: (e) => e.kind === "line" && resolve() }),
  );
  const childPid = (await running.pid())!;
  strays.push(childPid);
  const [hostPid] = hosts.pids();
  return { running, childPid, hostPid: hostPid! };
}

it("kills a process that ignores being asked to stop when its host shuts down", async () => {
  const hosts = hostsFor();
  const { childPid, hostPid } = await stubbornProcess(hosts);
  // The host is told to stop, as when the system shuts down.
  process.kill(hostPid, "SIGTERM");
  await expect
    .poll(() => alive(hostPid), { timeout: 6000, interval: 250 })
    .toBe(false);
  expect(alive(childPid)).toBe(false);
}, 15000);

it("kills a process Relay stopped before quitting, once its host has nothing left", async () => {
  const hosts = hostsFor();
  const { running, childPid, hostPid } = await stubbornProcess(hosts);
  // Relay quits for good: it closes its sessions, then lets go of the host.
  running.close();
  await new Promise((r) => setTimeout(r, 200));
  hosts.detach();
  await expect
    .poll(() => alive(hostPid), { timeout: 6000, interval: 250 })
    .toBe(false);
  expect(alive(childPid)).toBe(false);
}, 15000);
