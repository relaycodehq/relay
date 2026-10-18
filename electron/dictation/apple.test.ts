import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import { appleSpeechHelper } from "./apple";

it.skipIf(process.platform === "win32")(
  "launches the unpacked speech helper when the caller lives inside app.asar",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "relay-apple-packaged-"));
    try {
      // app.asar is a file, so spawning a path inside it fails with ENOTDIR.
      await writeFile(join(root, "app.asar"), "archive");
      const helper = join(
        root,
        "app.asar.unpacked",
        "dist-electron",
        "apple-speech",
      );
      await mkdir(dirname(helper), { recursive: true });
      await writeFile(helper, '#!/bin/sh\nprintf "ready"\n');
      await chmod(helper, 0o700);
      const path = appleSpeechHelper(join(root, "app.asar", "dist-electron"));
      expect(path).toBe(helper);
      expect((await promisify(execFile)(path)).stdout).toBe("ready");
      expect(appleSpeechHelper(join(root, "dist-electron"))).toBe(
        join(root, "dist-electron", "apple-speech"),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
