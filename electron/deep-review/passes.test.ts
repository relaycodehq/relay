import { it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm, realpath } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { ChatMessage, Project, ProjectChat } from "../../shared/projects";
import { defaultAISettings } from "../../shared/settings";
import type { DeepReviewStart } from "../../shared/deep-review";
import { DeepReviews, type DeepReviewHost } from "./index";

const choice = {
  ...defaultAISettings.questions,
  model: "fixture-model",
  reasoningEffort: "high" as const,
  fast: false,
};

const config = (patch: Partial<DeepReviewStart> = {}): DeepReviewStart => ({
  target: { kind: "uncommitted" },
  reviewers: [
    { provider: "codex", choice },
    { provider: "claude", choice },
  ],
  lead: { provider: "claude", choice },
  runChecks: true,
  focus: "",
  runtimeMode: "full-access",
  passes: [["src/"], ["lib/"]],
  seams: true,
  ...patch,
});

let root: string, repo: string;

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "relay-passes-")));
  repo = join(root, "repo");
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", repo, ...args], { stdio: "ignore" });
  await mkdir(join(repo, "src"), { recursive: true });
  await mkdir(join(repo, "lib"), { recursive: true });
  execFileSync("git", ["init", "--quiet", repo]);
  await writeFile(join(repo, "src", "queue.ts"), "export const queue = [];\n");
  git("add", ".");
  git("-c", "user.name=R", "-c", "user.email=r@x", "commit", "-qm", "Start");
  await writeFile(join(repo, "src", "queue.ts"), "export const queue = [1];\n");
  await writeFile(join(repo, "lib", "store.ts"), "export const store = 1;\n");
});

afterEach(() => rm(root, { recursive: true, force: true }));

/** Reviews run against threads kept in memory, whose agents answer when told to. */
function harness() {
  const threads = new Map<string, ProjectChat>();
  const working = new Set<string>();
  const asked: { chatId: string; body: string }[] = [];
  const leads: string[] = [];
  const host: DeepReviewHost = {
    load: async (id) => {
      const thread = threads.get(id);
      if (!thread) throw new Error(`No thread ${id}`);
      return thread;
    },
    project: () => ({}) as Project,
    root: async () => repo,
    worktrees: join(root, "worktrees"),
    createReviewer: async (parent, { task, title }) => {
      const thread = {
        id: randomUUID(),
        projectId: parent.projectId,
        scope: { kind: "review" },
        reviewer: task,
        title,
        messages: [],
      } as unknown as ProjectChat;
      threads.set(thread.id, thread);
      return thread;
    },
    send: async (chatId, input) => {
      asked.push({ chatId, body: input.body });
      working.add(chatId);
    },
    lead: async (_chat, _input, prompt) => {
      leads.push(prompt);
    },
    active: (id) => working.has(id),
    answering: () => false,
    waiting: () => false,
    live: () => true,
    finished: async () => {},
    windDown: async () => {},
    stop: () => {},
    close: () => {},
    touch: async () => {},
    discard: async (thread) => {
      threads.delete(thread.id);
    },
  };
  const reviews = new DeepReviews(host);
  const review = {
    id: "review",
    projectId: "project",
    scope: { kind: "review" },
    messages: [],
  } as unknown as ProjectChat;
  threads.set(review.id, review);
  const state = () => review.reviews!.at(-1)!;
  /** A reviewer's turn ends with `status`. */
  const answer = async (
    slot: number,
    status: ChatMessage["status"] = "complete",
  ) => {
    const chatId = state().reviewers[slot]!.chatId;
    threads.get(chatId)!.messages.push({
      id: randomUUID(),
      role: "assistant",
      body: `Report ${slot + 1}`,
      status,
      created: 0,
      provider: "codex",
      version: 1,
    });
    working.delete(chatId);
    await reviews.finished(chatId, {});
  };
  const askedSlots = () =>
    asked.map((a) => state().reviewers.findIndex((r) => r.chatId === a.chatId));
  return { reviews, review, state, answer, asked, askedSlots, leads, threads };
}

it("runs a split review's passes one after another, the seams last, then the lead", async () => {
  const { reviews, state, answer, asked, askedSlots, leads, threads } =
    harness();
  await reviews.start("review", config());

  // Every reviewer once a pass, named for it; only the first pass is asked.
  expect(state().reviewers.map((r) => r.pass)).toEqual([0, 0, 1, 1, 2, 2]);
  expect(threads.get(state().reviewers[2]!.chatId)!.title).toBe(
    "Reviewer 3 · pass 2 · Codex · fixture-model · high",
  );
  expect(askedSlots()).toEqual([0, 1]);
  // Claude's own review hears its pass after the command; Codex's, as its instructions.
  expect(asked[1]!.body).toMatch(/^@claude \/code-review high This change/);
  expect(asked[1]!.body).toContain("Yours is pass 1: `src/`");
  expect(asked[1]!.body).toContain("git diff HEAD -- 'src'");
  const codex = threads.get(state().reviewers[0]!.chatId)!.reviewer!.codex;
  expect(codex?.type === "custom" && codex.instructions).toContain(
    "Yours is pass 1: `src/`",
  );

  await answer(0);
  expect(askedSlots()).toEqual([0, 1]);
  await answer(1);
  expect(askedSlots()).toEqual([0, 1, 2, 3]);
  expect(state().pass).toBe(1);
  expect(asked[3]!.body).toContain("git diff HEAD -- 'lib'");

  await answer(2);
  await answer(3);
  expect(askedSlots()).toEqual([0, 1, 2, 3, 4, 5]);
  expect(asked[5]!.body).toContain("Review how those parts fit together");
  expect(asked[5]!.body).toContain("1. `src/`; 2. `lib/`");
  expect(leads).toHaveLength(0);

  await answer(4);
  await answer(5);
  expect(leads).toHaveLength(1);
  expect(leads[0]).toContain("split into 3 passes");
  const reports = JSON.parse(leads[0]!.split("Reviewer reports:\n")[1]!);
  expect(reports.map((r: { pass: number }) => r.pass)).toEqual([
    1, 1, 2, 2, 3, 3,
  ]);
});

it("holds the next pass while one of this pass's reviewers is stopped, and Resume asks only that one", async () => {
  const { reviews, state, answer, askedSlots, leads } = harness();
  await reviews.start("review", config({ seams: false }));
  await answer(0);
  await answer(1, "cancelled");
  expect(state().status).toBe("stopped");
  expect(askedSlots()).toEqual([0, 1]);

  await reviews.resume("review");
  expect(askedSlots()).toEqual([0, 1, 1]);
  await answer(1);
  expect(askedSlots()).toEqual([0, 1, 1, 2, 3]);
  await expect(reviews.resume("review", { slot: 2 })).rejects.toThrow(
    "already at work",
  );

  // Handing over early skips what's left of the passes.
  await answer(2, "cancelled");
  await answer(3);
  await reviews.resume("review", { lead: true });
  expect(leads).toHaveLength(1);
});

it("won't run a later pass's reviewer before its pass", async () => {
  const { reviews, answer } = harness();
  await reviews.start("review", config({ seams: false }));
  await answer(0, "cancelled");
  await expect(reviews.resume("review", { slot: 2 })).rejects.toThrow(
    "That reviewer's pass hasn't started yet.",
  );
});
