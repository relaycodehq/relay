import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import type { MessagePortMain } from "electron";
import type { DictationEvent } from "../../shared/dictation";
import { appleSpeechHelper, serveAppleSpeech } from "./apple";

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

it.skipIf(process.platform === "win32")(
  "tells the page it's ready only once the helper is, so a first-run install shows as loading",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "relay-apple-ready-"));
    try {
      const helper = join(root, "apple-speech");
      await writeFile(
        helper,
        '#!/bin/sh\nsleep 0.2\necho \'{"type":"ready"}\'\ncat >/dev/null\necho \'{"type":"final","text":"hi"}\'\n',
      );
      await chmod(helper, 0o700);
      const events: DictationEvent[] = [];
      let request: (message: unknown) => void = () => {};
      const arrived = (type: string) =>
        new Promise<void>((resolve) => {
          const check = setInterval(() => {
            if (events.some((e) => e.type === type)) {
              clearInterval(check);
              resolve();
            }
          }, 10);
        });
      serveAppleSpeech(
        {
          postMessage: (event: DictationEvent) => events.push(event),
          on: (
            name: string,
            listener: (message: { data: unknown }) => void,
          ) => {
            if (name === "message") request = (data) => listener({ data });
          },
          start: () => {},
        } as unknown as MessagePortMain,
        helper,
      );
      expect(events).toEqual([]);
      request({ type: "start", id: 1 });
      expect(events).toEqual([]);
      await arrived("ready");
      request({ type: "stop", id: 1 });
      await arrived("final");
      expect(events.map((e) => e.type)).toEqual(["ready", "final"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
