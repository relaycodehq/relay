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

  const record = (result = {}) =>
    writeJson(recordFile, { pid: process.pid, home, running, ...result });
  const run = (root, completed) => {
    running = root;
    record(completed ? { completed } : {});
    if (root !== home) log(`Running Relay from ${nameOf(root)} (${root}).`);
    // The runner asks Electron over IPC to quit, and cleans up Vite only
    // after it exits. No group signals: Chromium and hosts must stay alive
    // while an unsaved-edits prompt can still cancel the switch.
    child = spawn(process.execPath, ["scripts/dev.mjs"], {
      cwd: root,
      stdio: ["ignore", "inherit", "inherit", "ipc"],
      detached: true,
      env: { ...process.env, RELAY_DEV_HOME: home, RELAY_DEV_RUNNING: root },
    });
    child.on("message", (message) => {
      if (message?.type === "relay:dev-ready" && (next || quitting)) stop();
      if (message?.type !== "relay:dev-cancelled") return;
      record({ rejected: next?.id, error: "Relay's quit was cancelled." });
      next = null;
      quitting = false;
      log("Quit cancelled; keeping this Relay running.");
    });
    child.on("error", (error) => {
      log(`Could not start Relay: ${error.message}`);
      done(1);
    });
    child.on("exit", async (code) => {
      child = null;
      if (quitting) return done(0);
      // Vite's port and Relay's single-instance lock must be free first.
      await portFree(5177 + (Number(process.env.RELAY_PORT_OFFSET) || 0));
      const ask = next;
      next = null;
      try {
        if (ask?.restore) {
          restore(ask.restore);
          log(`Restored the data from ${ask.restore}.`);
          return run(home, ask.id);
        }
        if (ask?.to) {
          snapshot(`${nameOf(root)} to ${nameOf(ask.to)}`);
          return run(ask.to, ask.id);
        }
      } catch (error) {
        // Preserve the backup and leave Relay stopped if copying fails.
        log(`Could not switch or restore: ${error.message}`);
        return done(1);
      }
      if (root !== home) {
        log(`Relay from ${nameOf(root)} stopped; back to main.`);
        return run(home);
      }
      done(code ?? 0);
    });
  };

  const stop = () => {
    if (child?.connected) child.send({ type: "relay:dev-stop" });
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
    if (next || quitting) {
      record({ rejected: ask.id, error: "Relay is already stopping." });
      return;
    }
    if (ask.to) {
      const target = checkouts(home).find((c) => c.path === ask.to);
      if (!target || target.problem) {
        record({
          rejected: ask.id,
          error: target?.problem ?? "Not a checkout of this repository.",
        });
        return log(
          `Can't run Relay from ${ask.to}: ${target?.problem ?? "not a checkout of this repository"}.`,
        );
      }
      if (ask.to === running && !next) return;
    } else if (!ask.restore) return;
    next = ask;
    record();
    log(
      ask.to
        ? `Switching to ${nameOf(ask.to)}…`
        : `Stopping Relay to restore ${ask.restore}…`,
    );
    stop();
  });

  const quit = () => {
    quitting = true;
    if (child) stop();
    else done(0);
  };
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, quit);
  process.on("message", (message) => {
    if (message?.type === "relay:dev-stop") quit();
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
