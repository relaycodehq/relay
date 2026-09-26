import { afterEach, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentOptions } from "../../electron/agents/types";
import { defaultAISettings } from "../../shared/settings";

const runs: AgentOptions[] = [];
vi.mock("../../electron/agents", () => ({
  agentRuntime: () => ({
    run: async (options: AgentOptions) => {
      runs.push(options);
      return '{"subject":"Raise the limit","body":""}';
    },
  }),
}));
const { generateCommitMessage } =
  await import("../../electron/commit-messages");

let root: string;
afterEach(() => rm(root, { recursive: true, force: true }));

it("asks for a commit message under commit-message instructions, not a thread title's", async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "relay-commit-")));
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", root, ...args], { stdio: "pipe" });
  git("init", "-q");
  git("config", "user.name", "Test");
  git("config", "user.email", "test@example.invalid");
  await writeFile(join(root, "limit.ts"), "export const limit = 1;\n");
  git("add", ".");
  git("commit", "-qm", "Initial");
  await writeFile(join(root, "limit.ts"), "export const limit = 2;\n");

  const message = await generateCommitMessage(
    root,
    ["limit.ts"],
    defaultAISettings,
    new AbortController().signal,
  );

  expect(message).toBe("Raise the limit");
  expect(runs[0].helper?.instructions).toMatch(/commit message/);
  expect(runs[0].helper?.instructions).not.toMatch(/title/);
});
