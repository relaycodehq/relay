import { afterEach, beforeEach, expect, it } from "vitest";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runWorktreeCommand, type WorktreeEnv } from "./worktree-commands";

let worktree: WorktreeEnv;
beforeEach(async () => {
  const path = await realpath(await mkdtemp(join(tmpdir(), "relay-cmd-")));
  worktree = { path, root: "/checkout", branch: "relay/x", portOffset: 20 };
});
afterEach(() => rm(worktree.path, { recursive: true, force: true }));

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

it.skipIf(process.platform === "win32")(
  "runs in the worktree with its port offset and keeps both streams",
  async () => {
    const seen: string[] = [];
    const run = await runWorktreeCommand(
      'pwd; echo "offset $RELAY_PORT_OFFSET from $RELAY_PROJECT_ROOT on $RELAY_BRANCH"; echo oops >&2',
      worktree,
      { timeoutMs: 10_000, onOutput: (o) => seen.push(o) },
    );
    expect(run.exitCode).toBe(0);
    expect(run.output).toContain(worktree.path);
    expect(run.output).toContain("offset 20 from /checkout on relay/x");
    expect(run.output).toContain("oops");
    expect(seen.at(-1)).toBe(run.output);
  },
);

it.skipIf(process.platform === "win32")(
  "reports a failing command's exit code",
  async () => {
    const run = await runWorktreeCommand("echo nope; exit 3", worktree, {
      timeoutMs: 10_000,
    });
    expect(run).toEqual({ output: "nope\n", exitCode: 3 });
  },
);

it.skipIf(process.platform === "win32")(
  "stops the command and what it started on abort",
  async () => {
    const abort = new AbortController();
    let started!: (pid: number) => void;
    const ready = new Promise<number>((resolve) => (started = resolve));
    const running = runWorktreeCommand(
      'sleep 30 & child=$!; echo "pid:$child"; wait "$child"',
      worktree,
      {
        timeoutMs: 10_000,
        signal: abort.signal,
        onOutput: (output) => {
          const pid = /pid:(\d+)\n/.exec(output);
          if (pid) started(Number(pid[1]));
        },
      },
    );
    const pid = await ready;
    abort.abort();
    expect(await running).toMatchObject({ stopped: "cancelled" });
    await expect.poll(() => alive(pid)).toBe(false);
  },
);

it.skipIf(process.platform === "win32")(
  "gives up after its timeout",
  async () => {
    const run = await runWorktreeCommand("sleep 30", worktree, {
      timeoutMs: 200,
    });
    expect(run.stopped).toBe("timeout");
    expect(run.exitCode).toBeUndefined();
  },
);
