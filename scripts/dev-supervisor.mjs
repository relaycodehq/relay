#!/usr/bin/env node
// `npm run dev` in the main checkout. Runs Relay from it through
// scripts/dev.mjs, and from one of its worktrees when asked
// (scripts/dev-switch.mjs, or the sidebar's dev menu), always on the same data:
// one Relay to work in and to try changes with. Each switch stops the running
// Relay the way a rebuild does, so the agents carry on in their host, copies
// its records aside first (scripts/dev-home.mjs), and starts the other
// checkout's own dev.mjs. A worktree's Relay that stops on its own (quit,
// crash, a build that fails) hands back to main.
//
// Anywhere else (a worktree, which has its own port), beside a supervisor
// already running, or with RELAY_TEST_DATA, it is plain dev.mjs.
import { spawn } from "node:child_process";
import { realpathSync, rmSync, unwatchFile, watchFile } from "node:fs";
import { createConnection } from "node:net";
import { basename } from "node:path";
import {
  checkouts,
  checkoutName,
  readJson,
  recordFile,
  requestFile,
  restore,
  snapshot,
  supervisor,
  writeJson,
} from "./dev-home.mjs";

const here = realpathSync(".");
let list = [];
try {
  list = checkouts(here);
} catch {
  // Not a git checkout: nothing to switch between.
}
if (process.env.RELAY_TEST_DATA || list[0]?.path !== here || supervisor())
  await import("./dev.mjs");
else supervise(here);

function supervise(home) {
  const log = (text) => console.log(`\x1b[36m[relay dev]\x1b[0m ${text}`);
  const nameOf = (path) => {
    const c = checkouts(home).find((c) => c.path === path);
    return c ? checkoutName(c) : basename(path);
  };
  let child = null;
  let running = home;
  let next = null;
  let quitting = false;

  const run = (root) => {
    running = root;
    writeJson(recordFile, { pid: process.pid, home, running: root });
    if (root !== home) log(`Running Relay from ${nameOf(root)} (${root}).`);
    // Its own process group, so a switch can stop all of it: dev.mjs, Vite
    // and Electron. No stdin: Vite would read it from the background.
    child = spawn(process.execPath, ["scripts/dev.mjs"], {
      cwd: root,
      stdio: ["ignore", "inherit", "inherit"],
      detached: true,
      env: { ...process.env, RELAY_DEV_HOME: home, RELAY_DEV_RUNNING: root },
    });
    child.on("exit", async (code) => {
      child = null;
      if (quitting) return done(0);
      // Vite's port and Relay's single-instance lock must be free first.
      await portFree(5177 + (Number(process.env.RELAY_PORT_OFFSET) || 0));
      const ask = next;
      next = null;
      if (ask?.restore) {
        restore(ask.restore);
        log(`Restored the data from ${ask.restore}.`);
        return run(home);
      }
      if (ask?.to) {
        snapshot(`${nameOf(root)} to ${nameOf(ask.to)}`);
        return run(ask.to);
      }
      if (root !== home) {
        log(`Relay from ${nameOf(root)} stopped; back to main.`);
        return run(home);
      }
      done(code ?? 0);
    });
  };

  const stop = () => {
    if (!child) return;
    const pid = child.pid;
    try {
      process.kill(-pid, "SIGTERM");
    } catch {
      // Already gone.
    }
    setTimeout(() => {
      if (child?.pid !== pid) return;
      log("Relay didn't stop within 20 s; killing it.");
      try {
        process.kill(-pid, "SIGKILL");
      } catch {
        // Gone after all.
      }
    }, 20_000).unref();
  };

  const done = (code) => {
    unwatchFile(requestFile);
    if (readJson(recordFile)?.pid === process.pid)
      rmSync(recordFile, { force: true });
    process.exit(code);
  };

  rmSync(requestFile, { force: true });
  watchFile(requestFile, { interval: 500 }, () => {
    const ask = readJson(requestFile);
    if (!ask) return;
    rmSync(requestFile, { force: true });
    if (ask.to) {
      const target = checkouts(home).find((c) => c.path === ask.to);
      if (!target || target.problem)
        return log(
          `Can't run Relay from ${ask.to}: ${target?.problem ?? "not a checkout of this repository"}.`,
        );
      if (ask.to === running && !next) return;
    } else if (!ask.restore) return;
    next = ask;
    log(
      ask.to
        ? `Switching to ${nameOf(ask.to)}…`
        : `Stopping Relay to restore ${ask.restore}…`,
    );
    stop();
  });

  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, () => {
      quitting = true;
      if (child) stop();
      else done(0);
    });

  run(home);
}

async function portFree(port) {
  for (let i = 0; i < 100; i++) {
    const open = await new Promise((resolve) => {
      const socket = createConnection({ port, host: "127.0.0.1" });
      socket.once("connect", () => {
        socket.destroy();
        resolve(true);
      });
      socket.once("error", () => resolve(false));
    });
    if (!open) return;
    await new Promise((r) => setTimeout(r, 100));
  }
}
