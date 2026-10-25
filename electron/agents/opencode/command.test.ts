import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { fakeCli } from "../../../tests/fixtures/fake-cli";
import { setLinkedAgents } from "../../platform/executables";
import { openCodeCommand } from "./command";

const roots: string[] = [];

afterEach(async () => {
  setLinkedAgents({});
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

it("rejects OpenCode 1 and picks up an upgraded CLI without restarting Relay", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-opencode-command-"));
  roots.push(root);
  const command = await fakeCli(join(root, "opencode"), "", "1.19.0");
  setLinkedAgents({ opencode: command });
  await expect(openCodeCommand()).rejects.toThrow(
    "requires OpenCode 2 or later",
  );
  await fakeCli(join(root, "opencode"), "", "opencode v2.0.28");
  await expect(openCodeCommand()).resolves.toEqual({ command, args: ["acp"] });
});

it("explains the requirement when a CLI cannot report its version", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-opencode-command-"));
  roots.push(root);
  setLinkedAgents({
    opencode: await fakeCli(join(root, "opencode"), "", "unknown"),
  });
  await expect(openCodeCommand()).rejects.toThrow(
    "requires OpenCode 2 or later",
  );
});
