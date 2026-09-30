import { afterEach, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentOptions } from "../../electron/agents/types";
import {
  aiSettingsSchema,
  defaultAISettings,
  type AISettings,
} from "../../shared/settings";

const runs: (AgentOptions & { provider: string })[] = [];
vi.mock("../../electron/agents", () => ({
  agentRuntime: (provider: string) => ({
    run: async (options: AgentOptions) => {
      runs.push({ ...options, provider });
      return '{"subject":"Raise the limit","body":""}';
    },
  }),
}));
const { generateCommitMessage } =
  await import("../../electron/commit-messages");

let root: string;
afterEach(async () => {
  runs.length = 0;
  await rm(root, { recursive: true, force: true });
});

async function changedRepo() {
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
}
const write = (settings: AISettings) =>
  generateCommitMessage(
    root,
    ["limit.ts"],
    settings,
    new AbortController().signal,
  );

it("asks for a commit message under commit-message instructions, not a thread title's", async () => {
  await changedRepo();
  const message = await write(defaultAISettings);

  expect(message).toBe("Raise the limit");
  expect(runs[0].helper?.instructions).toMatch(/commit message/);
  expect(runs[0].helper?.instructions).not.toMatch(/title/);
});

it("drafts with the commit-message model, not the line questions'", async () => {
  await changedRepo();
  await write({
    ...defaultAISettings,
    questionsProvider: "claude",
    questions: { model: "opus", fast: false, reasoningEffort: "high" },
    commitMessageProvider: "cursor",
    commitMessage: { model: "composer-2", fast: false, reasoningEffort: "" },
  });
  expect(runs[0].provider).toBe("cursor");
  expect(runs[0].choice).toMatchObject({ model: "composer-2" });
});

it("keeps settings saved before the choice existed on Codex at low effort", async () => {
  await changedRepo();
  const { commitMessage, commitMessageProvider, ...saved } = defaultAISettings;
  await write(aiSettingsSchema.parse(saved));
  expect(runs[0].provider).toBe("codex");
  expect(runs[0].choice).toMatchObject({ model: "", reasoningEffort: "low" });
});
