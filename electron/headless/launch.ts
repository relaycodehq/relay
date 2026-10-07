import { spawn } from "node:child_process";
import { closeSync, mkdirSync, openSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import { callControl, NotRunning, type DaemonStatus } from "./control";
import { headlessPaths } from "./paths";
import { installedService, serviceHome, startService } from "./service";

/** What a Relay run as a service exits with to be started again. */
export const restartCode = 75;
/** What `relay run` exits with when this home's Relay already runs: nothing to restart. */
export const alreadyRunningCode = 3;

export class AlreadyRunning extends Error {}

const configSchema = z
  .object({
    port: z.number().int().min(1).max(65535).optional(),
    /** What phones and other computers call this one, instead of its host name. */
    name: z.string().trim().min(1).max(80).optional(),
    /** Installs releases as they come out; unset is on. */
    autoUpdate: z.boolean().optional(),
  })
  .passthrough();
/** What `relay` was told once and keeps: `headless.json` in the home folder. */
export type HeadlessConfig = z.infer<typeof configSchema>;

export async function readConfig(home: string): Promise<HeadlessConfig> {
  const text = await readFile(headlessPaths(home).config, "utf8").catch(
    () => "{}",
  );
  try {
    return configSchema.parse(JSON.parse(text));
  } catch {
    throw new Error(
      `${headlessPaths(home).config} isn't valid; fix or delete it.`,
    );
  }
}

export async function saveConfig(home: string, patch: HeadlessConfig) {
  const next = { ...(await readConfig(home)), ...patch };
  await mkdir(home, { recursive: true, mode: 0o700 });
  await writeFile(
    headlessPaths(home).config,
    JSON.stringify(next, null, 2) + "\n",
    {
      mode: 0o600,
    },
  );
}

/** The running Relay's status, or null when none answers. */
export async function running(home: string): Promise<DaemonStatus | null> {
  try {
    return await callControl(headlessPaths(home).control, "status");
  } catch (e) {
    if (e instanceof NotRunning) return null;
    throw e;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Waits for Relay to answer, or for `exited` to say it never will. */
async function answering(home: string, exited?: () => number | null) {
  for (const until = Date.now() + 60_000; Date.now() < until;) {
    const status = await running(home).catch(() => null);
    if (status) return status;
    const code = exited?.();
    // Losing to another Relay starting at the same moment is no failure.
    if (
      code !== null &&
      code !== undefined &&
      !(await holding(headlessPaths(home).pid))
    )
      throw new Error(
        `Relay exited (${code}) while starting. See ${join(headlessPaths(home).logs, "relay.out.log")} and \`relay logs\`.`,
      );
    await sleep(250);
  }
  throw new Error("Relay didn't answer within a minute; see `relay logs`.");
}

/** Waits for the Relay in `home` to stop answering and finish saving. */
export async function stopped(home: string, timeoutMs = 60_000) {
  const { pid } = headlessPaths(home);
  for (const until = Date.now() + timeoutMs; Date.now() < until;) {
    if (!(await running(home).catch(() => null)) && !(await holding(pid)))
      return;
    await sleep(250);
  }
  throw new Error("Relay is still running after a minute; see `relay logs`.");
}

/**
 * Starts Relay in the background: through the service when it's set up as
 * one for this home folder, so there's only ever one manager of it, else
 * as a detached process of its own.
 */
export async function startDetached(
  home: string,
  script: string,
): Promise<{ status: DaemonStatus; via: "service" | "process" }> {
  const service = installedService();
  if (service && (await serviceHome(service)) === home) {
    await startService();
    return { status: await answering(home), via: "service" };
  }
  const child = spawnRelay(home, script);
  let code: number | null = null;
  child.once("exit", (c) => (code = c ?? 1));
  return { status: await answering(home, () => code), via: "process" };
}

/** Relay in the background, apart from this process; what it prints goes to relay.out.log. */
export function spawnRelay(home: string, script: string) {
  const { logs } = headlessPaths(home);
  mkdirSync(logs, { recursive: true, mode: 0o700 });
  const out = openSync(join(logs, "relay.out.log"), "a", 0o600);
  const child = spawn(process.execPath, [script, "run", "--background"], {
    // Not wherever `relay` was typed: Windows can't rename a folder a process is in.
    cwd: home,
    detached: true,
    stdio: ["ignore", out, out],
    env: { ...process.env, RELAY_HOME: home },
    windowsHide: true,
  });
  closeSync(out);
  child.unref();
  return child;
}

/**
 * One Relay per home folder: its pid file is made exclusively, and only a
 * file whose process is gone is taken over.
 */
export async function claimHome(pidFile: string) {
  await mkdir(dirname(pidFile), { recursive: true, mode: 0o700 });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await writeFile(pidFile, `${process.pid}\n`, { mode: 0o600, flag: "wx" });
      return;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    }
    const pid = await holding(pidFile);
    if (pid && pid !== process.pid)
      throw new AlreadyRunning(
        `Relay is already running here (pid ${pid}). If it isn't, delete ${pidFile}.`,
      );
    await rm(pidFile, { force: true });
  }
  throw new Error(`Another Relay is starting here; see ${pidFile}.`);
}

function alive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // Someone else's process: alive, just not ours to signal.
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** The live process a pid file names, if any. */
async function holding(pidFile: string) {
  const pid = Number((await readFile(pidFile, "utf8").catch(() => "")).trim());
  return pid && alive(pid) ? pid : undefined;
}
