import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { setLinkedAgents } from "../../platform/executables";
import type { AgentRuntime } from "../types";
import { byGeneration, openCodeGeneration } from "./generation";

/** Links an `opencode` that prints `version` as its own. */
async function opencode(version: string) {
  const dir = await mkdtemp(join(tmpdir(), "relay-opencode-gen-"));
  const path = join(dir, "opencode");
  await writeFile(path, `#!/bin/sh\necho "${version}"\n`);
  await chmod(path, 0o755);
  setLinkedAgents({ opencode: path });
}

const runtime = (name: string, log: string[]): AgentRuntime => ({
  run: async () => name,
  closeSession: async (key) => void log.push(`${name} closes ${key}`),
  models: async () => [{ id: name, name, description: "", efforts: [] }],
  defaults: async () => null,
  commands: async () => [],
  reattach: async () => [{ key: `${name}-thread`, open: true }],
});

describe.skipIf(process.platform === "win32")(
  "which OpenCode runs a thread",
  () => {
    afterEach(() => setLinkedAgents({}));

    it("reads the major version off what each prints", async () => {
      await opencode("1.19.0");
      expect(await openCodeGeneration()).toBe(1);
      await opencode("opencode v2.0.28");
      expect(await openCodeGeneration()).toBe(2);
      // One that won't say is driven the old way, which explains itself.
      await opencode("something odd");
      expect(await openCodeGeneration()).toBe(1);
    });

    it("sends a turn to the installed one, and closing and reattaching to both", async () => {
      const log: string[] = [];
      const both = byGeneration(runtime("v1", log), runtime("v2", log));
      await opencode("1.19.0");
      expect(await both.run({} as never)).toBe("v1");
      await opencode("opencode v2.0.28");
      expect(await both.run({} as never)).toBe("v2");
      expect((await both.models()).map((m) => m.id)).toEqual(["v2"]);
      // Upgraded while a thread was open, its old session is let go too.
      await both.closeSession("t");
      expect(log).toEqual(["v1 closes t", "v2 closes t"]);
      expect(
        await both.reattach!(
          () => true,
          () => async () => {},
        ),
      ).toEqual([
        { key: "v1-thread", open: true },
        { key: "v2-thread", open: true },
      ]);
    });
  },
);
