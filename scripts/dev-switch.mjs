#!/usr/bin/env node
// Asks the `npm run dev` supervisor (scripts/dev-supervisor.mjs) to run Relay
// from another checkout of this repository, on the same data.
//
//   npm run dev:switch                       list the checkouts and snapshots
//   npm run dev:switch -- <checkout>         main, a branch, a folder name or a path
//   npm run dev:switch -- --restore [name]   put a snapshot's data back, then run main
//
//   --json      print the list as JSON (Relay's dev menu reads it)
//   --no-wait   ask and exit, without waiting for the other Relay to start
import { realpathSync } from "node:fs";
import { randomUUID } from "node:crypto";
import {
  checkoutName,
  checkouts,
  findCheckout,
  findSnapshot,
  listSnapshots,
  requestFile,
  supervisor,
  writeJson,
} from "./dev-home.mjs";

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const [name] = args.filter((a) => !a.startsWith("--"));
const running = supervisor();
const list = checkouts(running?.home ?? realpathSync("."));
const fail = (text) => {
  console.error(text);
  process.exit(1);
};

async function request(ask) {
  const id = randomUUID();
  writeJson(requestFile, { ...ask, id });
  if (flag("--no-wait")) return;
  for (let i = 0; i < 600; i++) {
    await new Promise((r) => setTimeout(r, 100));
    const record = supervisor();
    if (!record)
      fail("The dev supervisor stopped; see the `npm run dev` terminal.");
    if (record.rejected === id) fail(record.error);
    if (record.completed === id) return;
  }
  fail(
    "Relay hasn't stopped yet; check its quit dialog and the `npm run dev` terminal.",
  );
}

if (flag("--json")) {
  console.log(
    JSON.stringify({ running: running?.running ?? null, checkouts: list }),
  );
} else if (flag("--restore")) {
  if (!running) fail("No `npm run dev` is running to restore under.");
  const snapshot = findSnapshot(name);
  if (!snapshot)
    fail(name ? `No snapshot matches ${name}.` : "No snapshots yet.");
  await request({ restore: snapshot });
  console.log(`Restoring ${snapshot}; Relay starts again from main.`);
} else if (!name) {
  for (const c of list)
    console.log(
      `${c.path === running?.running ? "▸" : " "} ${checkoutName(c).padEnd(32)} ${c.problem ?? c.path}`,
    );
  const snapshots = listSnapshots();
  if (snapshots.length) {
    console.log("\nSnapshots, newest first:");
    for (const s of snapshots) console.log(`  ${s}`);
  }
  if (!running) console.log("\nNo `npm run dev` is running to switch.");
} else {
  if (!running) fail("No `npm run dev` is running to switch.");
  const target = findCheckout(list, name);
  if (!target) fail(`No checkout of this repository is called ${name}.`);
  if (target.problem)
    fail(`Can't run Relay from ${target.path}: ${target.problem}.`);
  if (target.path === running.running)
    fail(`Relay already runs from ${checkoutName(target)}.`);
  await request({ to: target.path });
  console.log(`Relay is starting from ${checkoutName(target)}.`);
}
