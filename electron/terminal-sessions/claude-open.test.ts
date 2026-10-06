import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { claudeOpen, runningSince } from "./claude-open";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "relay-claude-open-"));
});
afterEach(() => rm(dir, { recursive: true, force: true }));

const list = (home: string, pid: number, entry: object) =>
  writeFile(join(home, "sessions", `${pid}.json`), JSON.stringify({ pid, ...entry }));

it("counts a session open while the claude that listed it still runs", async () => {
  const home = join(dir, "claude");
  await mkdir(join(home, "sessions"), { recursive: true });
  await list(home, 101, { sessionId: "same-start", procStart: "Tue Oct  6 13:45:48 2026" });
  await list(home, 102, { sessionId: "pid-reused", procStart: "Mon Oct  5 09:00:00 2026" });
  await list(home, 103, { sessionId: "exited", procStart: "Tue Oct  6 10:00:00 2026" });
  await list(home, 104, { sessionId: "no-start" });
  await writeFile(join(home, "sessions", "105.json"), "{not json");
  const asked: number[][] = [];
  const open = await claudeOpen([home], async (pids) => {
    asked.push(pids);
    return new Map<number, string | undefined>([
      [101, "Tue Oct 6 13:45:48 2026"],
      [102, "Tue Oct 6 13:45:48 2026"],
      [104, undefined],
    ]);
  });
  expect([...open].sort()).toEqual(["no-start", "same-start"]);
  expect(asked).toHaveLength(1);
});

it("reads a sessions folder linked from another account once", async () => {
  const home = join(dir, "claude"),
    profile = join(dir, "profile");
  await mkdir(join(home, "sessions"), { recursive: true });
  await mkdir(profile);
  await symlink(join(home, "sessions"), join(profile, "sessions"));
  await list(home, 101, { sessionId: "s1" });
  const asked: number[][] = [];
  const open = await claudeOpen([home, profile, join(dir, "missing")], async (pids) => {
    asked.push(pids);
    return new Map([[101, undefined]]);
  });
  expect([...open]).toEqual(["s1"]);
  expect(asked).toEqual([[101]]);
});

it("reads running processes' start times as Claude Code records them", async () => {
  const gone = spawnSync(process.execPath, ["-e", ""]).pid!;
  const running = await runningSince([process.pid, gone]);
  expect(running.has(gone)).toBe(false);
  if (process.platform !== "win32")
    expect(running.get(process.pid)).toMatch(/^\w{3} \w{3} \d{1,2} \d\d:\d\d:\d\d \d{4}$/);
  else expect(running.has(process.pid)).toBe(true);
});
