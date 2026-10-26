import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentOptions } from "../agents/types";
import {
  aiSettingsSchema,
  defaultAISettings,
  type AISettings,
} from "../../shared/settings";
import { gitIn, initRepo } from "../../tests/fixtures/git-repo";

const runs: (AgentOptions & { provider: string })[] = [];
const plainReply = '{"subject":"Raise the limit","body":""}';
let reply = plainReply;
const failing = new Map<string, Error>();
vi.mock("../agents", () => ({
  agentRuntime: (provider: string) => ({
    run: async (options: AgentOptions) => {
      runs.push({ ...options, provider });
      const failure = failing.get(provider);
      if (failure) throw failure;
      return reply;
    },
  }),
}));
const { generateChangeCommitMessage, generateCommitMessage } =
  await import("./commit-messages");
const { NotInstalledError } = await import("../platform/executables");
const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

let root: string;
afterEach(async () => {
  runs.length = 0;
  failing.clear();
  warn.mockClear();
  reply = plainReply;
  await rm(root, { recursive: true, force: true });
});

async function changedRepo() {
  root = await realpath(await mkdtemp(join(tmpdir(), "relay-commit-")));
  const git = (...args: string[]) => gitIn(root, ...args);
  initRepo(root);
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
  expect(runs[0].prompt).toMatch(/Recent subjects:\nInitial\n/);
  expect(runs[0].job).toMatchObject({
    kind: "helper",
    instructions: expect.stringMatching(/commit message/),
  });
  expect(runs[0].job).not.toMatchObject({
    instructions: expect.stringMatching(/title/),
  });
});

it("writes one change's message from that change, not the file's other edits", async () => {
  await changedRepo();
  const message = await generateChangeCommitMessage(
    root,
    {
      path: "limit.ts",
      committed: "export const limit = 1;\n",
      content: "export const limit = 1;\nexport const max = 3;\n",
    },
    defaultAISettings,
    new AbortController().signal,
  );

  expect(message).toBe("Raise the limit");
  expect(runs[0].prompt).toMatch(/Files:\nM limit\.ts\n/);
  expect(runs[0].prompt).toMatch(/^\+export const max = 3;$/m);
  expect(runs[0].prompt).not.toMatch(/limit = 2/);
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

it("keeps settings saved before the choice existed on Codex Luna at low effort", async () => {
  await changedRepo();
  const { commitMessage, commitMessageProvider, ...saved } = defaultAISettings;
  await write(aiSettingsSchema.parse(saved));
  expect(runs[0].provider).toBe("codex");
  expect(runs[0].choice).toMatchObject({
    model: "gpt-6-luna",
    reasoningEffort: "low",
  });
});

it("drops the attribution lines agents like to sign off with", async () => {
  await changedRepo();
  reply = JSON.stringify({
    subject: "Raise the limit",
    body: "Two was enough for the new importer.\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)\n\nCo-Authored-By: Claude <noreply@anthropic.com>",
  });
  expect(await write(defaultAISettings)).toBe(
    "Raise the limit\n\nTwo was enough for the new importer.",
  );
});

it("stops on the chosen agent's own error instead of having Claude write in its place", async () => {
  await changedRepo();
  failing.set("codex", new Error("Codex sandbox refused to start"));
  await expect(write(defaultAISettings)).rejects.toThrow(
    "Codex sandbox refused to start",
  );
  expect(runs.map((r) => r.provider)).toEqual(["codex"]);
  expect(warn).toHaveBeenCalledWith(
    expect.stringMatching(/commitMessage failed on Codex:$/),
    expect.any(Error),
  );
});

it("lets Claude write on its own model only when Codex isn't installed", async () => {
  await changedRepo();
  failing.set("codex", new NotInstalledError("codex was not found."));
  expect(await write(defaultAISettings)).toBe("Raise the limit");
  expect(runs.map((r) => r.provider)).toEqual(["codex", "claude"]);
  expect(runs[1].choice).toMatchObject({ model: "", reasoningEffort: "" });
  expect(warn).toHaveBeenCalledWith(
    expect.stringMatching(/failed on Codex; trying Claude:$/),
    expect.any(NotInstalledError),
  );
});
