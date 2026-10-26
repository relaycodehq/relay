import {
  root,
  repo,
  chats,
  projectId,
  useProjectChats,
} from "../../tests/fixtures/project-chats-harness";
// An agent runs a deep review in its own thread through Relay's tool, the way
// a real one does: the fake Codex calls deep_review over the MCP server
// mid-answer, its reviewers work where the thread does, and the reports come
// back to it once that answer ended.
import { it, expect, vi, beforeEach, afterEach } from "vitest";
import { writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { defaultAISettings } from "../../shared/settings";
import type { SavedReviewSetup } from "../../shared/deep-review";
import { StartedThreads } from "../started-threads";
import { serveRelayTools, useRelayMcp, verifyRelayToken } from "../relay-mcp";
vi.mock("../platform/executables");

const secret = "c".repeat(64);
let closeTools: () => Promise<void>;
const git = (...args: string[]) =>
  execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" });
const choice = { ...defaultAISettings.questions, model: "fixture-model" };
let setups: SavedReviewSetup[];

useProjectChats({
  prepare: async () => {
    git("branch", "-m", "main");
    await writeFile(join(repo, "README.md"), "Hello\n");
    git("add", ".");
    git(
      "-c",
      "user.name=T",
      "-c",
      "user.email=t@example.invalid",
      "commit",
      "-qm",
      "Initial",
    );
  },
});

beforeEach(async () => {
  setups = [
    {
      id: "quick",
      at: 1,
      name: "Quick",
      setup: {
        reviewers: [{ provider: "codex", choice }],
        lead: { provider: "claude", choice },
        runChecks: false,
      },
    },
  ];
  const serving = serveRelayTools(0, {
    verify: (token) => verifyRelayToken(secret, token),
    call: new StartedThreads(chats, {
      reviews: {
        setups: () => setups,
        start: (id, config) =>
          chats.startDeepReview(id, config, { duringTurn: true }),
      },
    }).handle,
  });
  await serving.ready;
  closeTools = serving.close;
  const { port } = serving.server.address() as { port: number };
  useRelayMcp({ port, secret });
});

afterEach(async () => {
  useRelayMcp(undefined);
  await closeTools?.();
});

const input = (body: string) => ({
  id: randomUUID(),
  body,
  provider: "codex" as const,
  runtimeMode: "full-access" as const,
  interactionMode: "default" as const,
  choice,
});

const relay = (tool: string, args: object) =>
  input(`@codex fixture relay ${tool} ${JSON.stringify(args)}`);

it("reviews where the thread works, and hands the reports to its agent once its answer ended", async () => {
  await writeFile(join(repo, "queue.ts"), "export const queue = [1];\n");
  const chat = await chats.create(projectId, { kind: "project" });
  await chats.send(
    chat.id,
    relay("move_to_worktree", { branch: "relay/queue", uncommitted: true }),
  );
  await vi.waitFor(async () =>
    expect((await chats.get(chat.id)).messages.at(-1)?.status).toBe("complete"),
  );
  const folder = (await chats.get(chat.id)).worktree!.path!;

  await chats.send(chat.id, relay("deep_review", { focus: "the queue" }));
  await vi.waitFor(
    async () =>
      expect((await chats.get(chat.id)).reviews?.at(-1)?.status).toBe("done"),
    { timeout: 20_000 },
  );
  const done = await chats.get(chat.id);
  const round = done.reviews![0]!;
  // Reviewed where the thread works, and never moved it anywhere else.
  expect(round.scope.folder).toBe(folder);
  expect(round.scope.checkout).toBeUndefined();
  expect(done.worktree?.path).toBe(folder);
  expect(done.title).not.toContain("Deep review");
  // The thread's own agent leads, on its own settings.
  expect(round.lead).toEqual({ provider: "codex", choice });

  const [asked, request, lead] = done.messages.slice(-3);
  expect(asked!.role).toBe("assistant");
  expect(request!.id).toBe(round.request);
  expect(lead!.role).toBe("assistant");
  // Not before the answer that asked for it ended.
  expect(lead!.created).toBeGreaterThanOrEqual(asked!.ended!);
  expect(done.findings?.reports.map((r) => r.messageId)).toEqual([lead!.id]);

  const reviewer = await chats.get(round.reviewers[0]!.chatId);
  expect(reviewer.reviewer).toMatchObject({
    parent: chat.id,
    round: round.request,
  });
  const calls = (await readFile(join(root, "capture.jsonl"), "utf8"))
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const review = calls.find((c) => c.review);
  // A focus turns Codex's built-in review into its custom one, which carries it.
  expect(review.review.target).toMatchObject({ type: "custom" });
  expect(review.review.target.instructions).toContain('"the queue"');
  const reviewerThread = calls.find(
    (c) =>
      c.thread &&
      c.method === "thread/start" &&
      c.thread.sandbox === "read-only",
  );
  expect(reviewerThread.thread.cwd).toBe(folder);
});

it("hands the reports over once a turn Claude started by itself, which asked for the round, ends", async () => {
  await writeFile(join(repo, "README.md"), "Hello again\n");
  // Claude's turn runs on until the test opens this.
  const gate = join(root, "unprompted-gate");
  vi.stubEnv("RELAY_FIXTURE_GATE", gate);
  const chat = await chats.create(projectId, { kind: "project" });
  await chats.send(
    chat.id,
    input("@claude fixture background relay deep_review {}"),
  );
  // Its reviewers report while that turn still runs.
  const asked = await vi.waitFor(
    async () => {
      const thread = await chats.get(chat.id);
      const asked = thread.messages.find((m) => m.unprompted);
      expect(asked?.status).toBe("streaming");
      const reviewer = await chats.get(
        thread.reviews![0]!.reviewers[0]!.chatId,
      );
      expect(reviewer.messages.at(-1)).toMatchObject({
        role: "assistant",
        status: "complete",
      });
      return asked!;
    },
    { timeout: 20_000 },
  );
  expect((await chats.get(chat.id)).reviews![0]!.status).toBe("reviewing");

  await writeFile(gate, "");
  await vi.waitFor(
    async () =>
      expect((await chats.get(chat.id)).reviews?.[0]?.status).toBe("done"),
    { timeout: 20_000 },
  );
  const done = await chats.get(chat.id);
  const lead = done.messages.at(-1)!;
  expect(lead.role).toBe("assistant");
  expect(lead.created).toBeGreaterThanOrEqual(
    done.messages.find((m) => m.id === asked.id)!.ended!,
  );
  expect(done.findings?.reports.map((r) => r.messageId)).toEqual([lead.id]);
  // "@claude" picked the agent, and so the lead, over the picker's Codex.
  expect(done.reviews![0]!.lead.provider).toBe("claude");
});

it("names the setups to pick from when the one asked for isn't saved", async () => {
  const chat = await chats.create(projectId, { kind: "project" });
  await chats.send(chat.id, relay("deep_review", { setup: "Thorough" }));
  await vi.waitFor(async () =>
    expect((await chats.get(chat.id)).messages.at(-1)?.status).toBe("complete"),
  );
  const done = await chats.get(chat.id);
  expect(done.reviews).toBeUndefined();
  // The fake agent answers with what the tool told it.
  expect(done.messages.at(-1)?.body).toContain(
    'There\'s no review setup named "Thorough". These are: "Quick".',
  );
});
