import { afterEach, expect, it, vi } from "vitest";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { git, gitInfo, gitVersion, setGitPath } from "./git";
import { isGitMissing } from "../../shared/working-tree";

afterEach(() => setGitPath(null));

it("finds Git by itself", async () => {
  const info = await gitInfo();
  expect(info).toMatchObject({ chosen: false, error: null });
  expect(info.version).toMatch(/^git version/);
});

it("says Git is missing when the chosen one is gone", async () => {
  setGitPath(join(tmpdir(), "no-such-git", "git.exe"));
  const failure = await git(process.cwd(), ["--version"]).catch((e) => e);
  expect(isGitMissing(failure)).toBe(true);
  expect(await gitInfo()).toMatchObject({ chosen: true, version: null });
  setGitPath(null);
  expect((await gitInfo()).version).toMatch(/^git version/);
});

it("won't take a program that isn't Git", async () => {
  const dir = await mkdtemp(join(tmpdir(), "relay-not-git-"));
  try {
    const file = join(dir, "notes.txt");
    await writeFile(file, "not a program");
    await expect(gitVersion(file)).rejects.toThrow(/Git/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it.skipIf(process.platform === "win32")(
  "waits for an aborted Git process before callers can clean up its folder",
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "relay-git-abort-"));
    try {
      const file = join(dir, "git"),
        ready = join(dir, "ready"),
        done = join(dir, "done");
      const script = `#!${process.execPath}\nconst fs = require('node:fs'); process.on('SIGTERM', () => setTimeout(() => { fs.writeFileSync(${JSON.stringify(done)}, 'done'); process.exit(); }, 100)); fs.writeFileSync(${JSON.stringify(ready)}, 'ready'); setInterval(() => {}, 1000);`;
      await writeFile(file, script);
      await chmod(file, 0o755);
      setGitPath(file);
      const stop = new AbortController();
      const running = git(dir, ["commit"], { signal: stop.signal });
      const failed = expect(running).rejects.toThrow("Cancelled.");
      await vi.waitFor(async () =>
        expect(await readFile(ready, "utf8")).toBe("ready"),
      );
      stop.abort();
      await failed;
      expect(await readFile(done, "utf8")).toBe("done");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
);

it.skipIf(process.platform === "win32")(
  "stops a real commit hook before cancellation settles",
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "relay-git-hook-abort-"));
    let pid: number | undefined;
    try {
      await git(dir, ["init"]);
      const ready = join(dir, "ready"),
        done = join(dir, "done");
      const hook = join(dir, ".git", "hooks", "pre-commit");
      await writeFile(
        hook,
        `#!${process.execPath}\nconst fs=require('node:fs'); process.on('SIGTERM',()=>{}); fs.writeFileSync(${JSON.stringify(ready)},String(process.pid)); setTimeout(()=>fs.writeFileSync(${JSON.stringify(done)},'still running'),3000); setInterval(()=>{},1000);`,
      );
      await chmod(hook, 0o755);
      const stop = new AbortController();
      const running = git(
        dir,
        [
          "-c",
          "user.name=Test",
          "-c",
          "user.email=test@example.invalid",
          "commit",
          "--allow-empty",
          "-m",
          "test",
        ],
        { signal: stop.signal },
      );
      const failed = expect(running).rejects.toThrow("Cancelled.");
      await vi.waitFor(async () => {
        pid = Number(await readFile(ready, "utf8"));
        expect(pid).toBeGreaterThan(0);
      });
      stop.abort();
      await failed;
      expect(() => process.kill(pid!, 0)).toThrow();
      await expect(readFile(done, "utf8")).rejects.toThrow();
    } finally {
      if (pid)
        try {
          process.kill(pid, "SIGKILL");
        } catch {}
      await rm(dir, { recursive: true, force: true });
    }
  },
);
