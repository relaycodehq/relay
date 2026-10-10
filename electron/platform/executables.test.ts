import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { existsSync, watch, type FSWatcher } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./shell-path", () => ({ pathReady: async () => {} }));

import {
  findExecutable,
  runExecutable,
  setLinkedAgents,
  setLinkedTools,
} from "./executables";

const posix = process.platform !== "win32";
let root: string;
const saved = { ...process.env };
const watchers: FSWatcher[] = [];

function fileSignal(file: string) {
  return new Promise<void>((resolve, reject) => {
    const watcher = watch(dirname(file), () => {
      if (!existsSync(file)) return;
      watcher.close();
      resolve();
    });
    watchers.push(watcher);
    watcher.on("error", reject);
    if (existsSync(file)) {
      watcher.close();
      resolve();
    }
  });
}

async function program(dir: string, name: string, body: string) {
  await mkdir(dir, { recursive: true });
  const file = join(dir, name);
  await writeFile(file, `#!/bin/sh\n${body}\n`);
  await chmod(file, 0o755);
  return file;
}
const working = (name: string) => `echo "${name} 1.2.3"`;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "relay-exec-"));
  process.env.HOME = root;
  process.env.MISE_DATA_DIR = join(root, "mise");
  process.env.PATH = join(root, "bin");
  setLinkedAgents({});
  setLinkedTools({});
});

afterEach(async () => {
  for (const watcher of watchers.splice(0)) watcher.close();
  process.env = { ...saved };
  setLinkedAgents({});
  setLinkedTools({});
  await rm(root, { recursive: true, force: true });
});

describe.skipIf(!posix)("finding an agent CLI", () => {
  it("skips a program on PATH that can't say its version", async () => {
    await program(join(root, "bin"), "claude", "exit 1");
    const real = await program(
      join(root, ".volta/bin"),
      "claude",
      working("claude"),
    );
    expect(await findExecutable("claude")).toBe(real);
  });

  it("skips a stub that can't even start, as blocked install scripts leave", async () => {
    const stub = join(root, "bin/claude");
    await mkdir(join(root, "bin"), { recursive: true });
    await writeFile(stub, 'echo "claude native binary not installed" >&2\n');
    await chmod(stub, 0o755);
    process.env.PATH = [join(root, "bin"), join(root, "later")].join(delimiter);
    const real = await program(
      join(root, "later"),
      "claude",
      working("claude"),
    );
    expect(await findExecutable("claude")).toBe(real);
  });

  it("finds a mise install that no shell put on PATH", async () => {
    const real = await program(
      join(root, "mise/installs/aqua-anomalyco-opencode/latest"),
      "opencode",
      working("opencode"),
    );
    expect(await findExecutable("opencode")).toBe(real);
  });

  it("prefers a mise install to its shim", async () => {
    await program(join(root, "mise/shims"), "codex", "exit 1");
    const real = await program(
      join(root, "mise/installs/codex/latest/bin"),
      "codex",
      working("codex"),
    );
    expect(await findExecutable("codex")).toBe(real);
  });

  it("falls back to the first program found when none answers", async () => {
    const first = await program(join(root, "bin"), "claude", "exit 1");
    await program(join(root, ".volta/bin"), "claude", "exit 1");
    expect(await findExecutable("claude")).toBe(first);
  });

  it("uses a linked program before searching", async () => {
    await program(join(root, "bin"), "codex", working("codex"));
    const mine = await program(join(root, "elsewhere"), "codex", "exit 1");
    setLinkedAgents({ codex: mine });
    expect(await findExecutable("codex")).toBe(mine);
  });

  it("says so when a linked program is gone", async () => {
    setLinkedAgents({ codex: join(root, "gone/codex") });
    await expect(findExecutable("codex")).rejects.toThrow(/linked in Settings/);
  });

  it("reports an agent that is nowhere", async () => {
    await expect(findExecutable("opencode")).rejects.toThrow(/not found/);
  });

  it("uses a linked gh before the one on PATH, and says when it is gone", async () => {
    await program(join(root, "bin"), "gh", working("gh"));
    const mine = await program(join(root, "elsewhere"), "gh", working("gh"));
    setLinkedTools({ gh: mine });
    expect(await findExecutable("gh")).toBe(mine);
    setLinkedTools({ gh: join(root, "gone/gh") });
    await expect(findExecutable("gh")).rejects.toThrow(/linked in Settings/);
  });
});

it.skipIf(!posix)(
  "waits for a cancelled executable to exit before rejecting",
  async () => {
    const ready = join(root, "ready"),
      stopping = join(root, "stopping"),
      release = join(root, "release"),
      done = join(root, "done");
    const stop = new AbortController();
    let settled = false;
    const readySignal = fileSignal(ready);
    const stoppingSignal = fileSignal(stopping);
    const script = `
      const fs = require('node:fs');
      const signal = (file, text) => {
        fs.writeFileSync(file + '.tmp', text);
        fs.renameSync(file + '.tmp', file);
      };
      let cancelled = false;
      const finish = () => {
        if (cancelled && fs.existsSync(${JSON.stringify(release)})) {
          fs.writeFileSync(${JSON.stringify(done)}, 'done');
          process.exit();
        }
      };
      fs.watch(${JSON.stringify(root)}, finish);
      process.on('SIGTERM', () => {
        cancelled = true;
        signal(${JSON.stringify(stopping)}, 'stopping');
        finish();
      });
      signal(${JSON.stringify(ready)}, 'ready');
    `;
    const running = runExecutable(
      process.execPath,
      ["-e", script],
      5000,
      stop.signal,
    );
    const failed = expect(running).rejects.toThrow("Cancelled.");
    void running.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    try {
      await readySignal;
      expect(await readFile(ready, "utf8")).toBe("ready");
      stop.abort();
      await stoppingSignal;
      expect(await readFile(stopping, "utf8")).toBe("stopping");
      // SIGTERM arrived, but the fixture cannot exit until we release it.
      expect(settled).toBe(false);
    } finally {
      stop.abort();
      await writeFile(release, "release");
      await failed;
    }
    expect(await readFile(done, "utf8")).toBe("done");
  },
);

it.skipIf(!posix)("cancels subprocesses spawned by an executable", async () => {
  const ready = join(root, "child-ready"),
    done = join(root, "child-done");
  const readySignal = fileSignal(ready);
  const childScript = `const fs = require('node:fs'); process.on('SIGTERM', () => { fs.writeFileSync(${JSON.stringify(done)}, 'stopped'); process.exit(); }); fs.writeFileSync(${JSON.stringify(ready + ".tmp")}, 'ready'); fs.renameSync(${JSON.stringify(ready + ".tmp")}, ${JSON.stringify(ready)}); setInterval(() => {}, 1000);`;
  const parentScript = `require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(childScript)}], {stdio:'inherit'}); setInterval(() => {}, 1000);`;
  const stop = new AbortController();
  const running = runExecutable(
    process.execPath,
    ["-e", parentScript],
    5000,
    stop.signal,
  );
  const failed = expect(running).rejects.toThrow("Cancelled.");
  await readySignal;
  expect(await readFile(ready, "utf8")).toBe("ready");
  stop.abort();
  await failed;
  expect(await readFile(done, "utf8")).toBe("stopped");
});
