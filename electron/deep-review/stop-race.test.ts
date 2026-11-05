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
  seams: false,
  ...patch,
});

let root: string, repo: string;

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "relay-stop-race-")));
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

/** As passes.test.ts's harness, with a save that can be held mid-way. */
function harness() {
  const threads = new Map<string, ProjectChat>();
  const working = new Set<string>();
  const asked: string[] = [];
  let hold: Promise<void> | undefined;
  let saving: (() => void) | undefined;
  const heldSends = new Map<string, Promise<void>>();
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
    // Like the real host, a turn tells the review it's starting.
    send: async (chatId) => {
      asked.push(chatId);
      await heldSends.get(chatId);
      working.add(chatId);
      await reviews.memberStarting(threads.get(chatId)!);
    },
    lead: async () => {},
    active: (id) => working.has(id),
    answering: () => false,
    waiting: () => false,
    live: () => true,
    finished: async () => {},
    windDown: async () => {},
    stop: (id) => {
      working.delete(id);
    },
    close: () => {},
    touch: async () => {
      const held = hold;
      if (!held) return;
      hold = undefined;
      saving?.();
      await held;
    },
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
    } as ChatMessage);
    working.delete(chatId);
    return reviews.finished(chatId, {});
  };
  /** Holds the next save until `release`; `started` resolves once it waits. */
  const holdNextSave = () => {
    let release!: () => void;
    hold = new Promise<void>((r) => (release = r));
    const started = new Promise<void>((r) => (saving = r));
    return { started, release: () => release() };
  };
  const askedSlots = () =>
    asked.map((id) => state().reviewers.findIndex((r) => r.chatId === id));
  /** Holds the next send to `slot` until `release`. */
  const holdSend = (slot: number) => {
    let release!: () => void;
    const chatId = state().reviewers[slot]!.chatId;
    heldSends.set(
      chatId,
      new Promise<void>((r) => (release = r)).then(() => {
        heldSends.delete(chatId);
      }),
    );
    return () => release();
  };
  return {
    reviews,
    review,
    threads,
    state,
    answer,
    askedSlots,
    holdNextSave,
    holdSend,
    working,
  };
}

it("doesn't start the next pass's reviewers when Stop lands while the pass hands over", async () => {
  const { reviews, review, state, answer, askedSlots, holdNextSave, working } =
    harness();
  await reviews.start("review", config());
  expect(askedSlots()).toEqual([0, 1]);
  await answer(0);

  // The last reviewer of pass 1 reports; the handover saves the new pass first.
  const save = holdNextSave();
  const handover = answer(1);
  await save.started;
  expect(state().pass).toBe(1);

  // The user stops the review while that save is on its way to disk.
  await reviews.stop(review);
  expect(state().status).toBe("stopped");
  save.release();
  await handover;

  // Nobody of pass 2 is at work on a stopped review.
  expect(askedSlots()).toEqual([0, 1]);
  expect(state().reviewers.some((r) => working.has(r.chatId))).toBe(false);
  expect(state().status).toBe("stopped");
});

it("doesn't send the reviewers Resume asked for when Stop lands while Resume saves", async () => {
  const { reviews, review, state, answer, askedSlots, holdNextSave, working } =
    harness();
  await reviews.start("review", config());
  await answer(0);
  await answer(1, "cancelled");
  expect(state().status).toBe("stopped");

  const save = holdNextSave();
  const resuming = reviews.resume("review");
  await save.started;
  await reviews.stop(review);
  save.release();
  await resuming;

  expect(askedSlots()).toEqual([0, 1]);
  expect(state().reviewers.some((r) => working.has(r.chatId))).toBe(false);
  expect(state().status).toBe("stopped");
});

it("runs the reviewers Resume asked for while a stopped send was still on its way", async () => {
  const { reviews, review, state, answer, holdSend, working } = harness();
  await reviews.start("review", config());
  await answer(0, "cancelled");
  await answer(1, "cancelled");
  expect(state().status).toBe("stopped");

  // Resume sends both again; the second one's agent is slow to take it.
  const release = holdSend(1);
  const resuming = reviews.resume("review");
  await new Promise((r) => setTimeout(r, 0));
  await reviews.stop(review);
  expect(state().status).toBe("stopped");

  // A quick Resume while that send is still on its way.
  const again = reviews.resume("review");
  await new Promise((r) => setTimeout(r, 0));
  release();
  await Promise.all([resuming, again]);

  const first = state().reviewers[0]!.chatId;
  expect(working.has(first)).toBe(true);
  expect(state().status).toBe("reviewing");
});

it("lets the user go on with a reviewer whose task went out before Stop, while another's is still on its way", async () => {
  const { reviews, review, threads, state, answer, holdSend, working } =
    harness();
  await reviews.start("review", config());
  await answer(0, "cancelled");
  await answer(1, "cancelled");

  // Resume sends both again; the second one's agent is slow to take it.
  const release = holdSend(1);
  const resuming = reviews.resume("review");
  await new Promise((r) => setTimeout(r, 0));
  const first = state().reviewers[0]!.chatId;
  expect(working.has(first)).toBe(true);
  await reviews.stop(review);

  // The user writes in the first reviewer's thread themselves.
  working.add(first);
  await reviews.memberStarting(threads.get(first)!);
  expect(working.has(first)).toBe(true);

  release();
  await resuming;
});
