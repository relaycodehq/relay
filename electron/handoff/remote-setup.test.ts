import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { runCommand } from "./remote-setup";

it.skipIf(process.platform === "win32")(
  "stops a remote command's descendants before reporting a timeout",
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "relay-command-timeout-"));
    const done = join(dir, "stopped");
    const child = join(dir, "child.cjs");
    // The shell waits for this child. Killing only the shell leaves it alive.
    await writeFile(
      child,
      `
    const fs = require('node:fs');
    process.on('SIGTERM', () => { fs.writeFileSync(${JSON.stringify(done)}, 'stopped'); process.exit(); });
    console.log('ready');
    setInterval(() => {}, 1000);
  `,
    );
    const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
    vi.stubEnv("SHELL", "/bin/sh");
    try {
      const result = await runCommand(
        `${quote(process.execPath)} ${quote(child)} & wait`,
        1000,
        "Test computer",
      );
      expect(result.timedOut).toBe(true);
      expect(result.output).toContain("ready");
      expect(await readFile(done, "utf8")).toBe("stopped");
    } finally {
      vi.unstubAllEnvs();
      await rm(dir, { recursive: true, force: true });
    }
  },
);
