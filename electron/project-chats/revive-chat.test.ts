import { expect, it } from "vitest";
import { reviveChat } from "./revive";
import { reviewThreadTitle, type ReviewScope } from "../../shared/deep-review";
import type { ChatMessage, ProjectChat } from "../../shared/projects";

const message = (fields: Partial<ChatMessage>): ChatMessage => ({
  id: crypto.randomUUID(),
  role: "assistant",
  body: "",
  status: "complete",
  created: 1,
  provider: "claude",
  version: 1,
  ...fields,
});

const thread = (fields: Partial<ProjectChat>): ProjectChat => ({
  id: "t",
  projectId: "p",
  scope: { kind: "project" },
  title: "Thread",
  created: 1,
  updated: 1,
  messages: [],
  ...fields,
});

const prScope: ReviewScope = {
  target: { kind: "pr", ref: { owner: "relay", name: "relay", number: 4 } },
  label: "PR #4",
  title: "Linked folders and an add-project palette",
  branch: "main",
};

const review = (): NonNullable<ProjectChat["deepReview"]> => ({
  scope: prScope,
  request: "request",
  reviewers: [],
  lead: {
    provider: "codex",
    choice: { model: "", reasoningEffort: "medium", fast: false },
  },
  runChecks: false,
  runtimeMode: "full-access",
  status: "done",
});

it("names reviews after their PR or commit, keeping valid bounded thread names", () => {
  expect(reviewThreadTitle(prScope)).toBe(
    "Deep review · PR #4 · Linked folders and an add-project palette",
  );
  expect(reviewThreadTitle({ ...prScope, title: undefined })).toBe(
    "Deep review · PR #4",
  );
  expect(
    reviewThreadTitle({ ...prScope, title: "Fix\n\tlinked folders" }),
  ).toBe("Deep review · PR #4 · Fix linked folders");
  const long = reviewThreadTitle({ ...prScope, title: "A".repeat(200) });
  expect(long).toHaveLength(120);
  expect(long.endsWith("…")).toBe(true);
});

it("adds the saved PR title to an old review without changing its activity date", () => {
  const chat = thread({
    title: "Deep review · PR #4",
    scope: { kind: "review" },
    deepReview: review(),
  });
  expect(reviveChat(chat, () => false)).toBe(true);
  expect(chat.title).toBe(reviewThreadTitle(prScope));
  expect(chat.updated).toBe(1);
  expect(reviveChat(chat, () => false)).toBe(false);
});

it("keeps manually renamed and generated review names", () => {
  for (const fields of [
    { title: "Deep review · PR #4", renamed: true },
    { title: "Check linked folders" },
  ]) {
    const chat = thread({ ...fields, deepReview: review() });
    expect(reviveChat(chat, () => false)).toBe(false);
    expect(chat.title).toBe(fields.title);
  }
});

it("leaves a thread saved in today's format alone", () => {
  const chat = thread({ messages: [message({ body: "Done." })] });
  const before = structuredClone(chat);
  expect(reviveChat(chat, () => false)).toBe(false);
  expect(chat).toEqual(before);
});

it("fails an answer the app closed on, unless its session is still in that turn", () => {
  const cut = message({ status: "streaming", body: "Half" });
  const live = message({ status: "streaming", parentId: "side" });
  const chat = thread({ messages: [cut, live] });
  expect(reviveChat(chat, (m) => m.parentId === "side")).toBe(true);
  expect(cut).toMatchObject({ status: "failed", body: "Half", version: 2 });
  expect(cut.error).toMatch(/app closed/);
  expect(live.status).toBe("streaming");
});

it("pauses a queue that was waiting when Relay closed and moves old modes over", () => {
  const input = {
    id: "q",
    body: "@codex hi",
    provider: "codex",
    choice: { model: "", reasoningEffort: "", fast: false },
    mode: "read-only",
  } as unknown as ProjectChat["lastInput"] & object;
  const chat = thread({ queue: [{ input, created: 1 }] });
  expect(reviveChat(chat, () => false)).toBe(true);
  expect(chat.queuePaused).toBe(true);
  expect(input).toMatchObject({ interactionMode: "default" });
  expect(input.runtimeMode).toBeTruthy();
  expect("mode" in input).toBe(false);
});

it("stops reviews an earlier session left running, reopening findings being fixed", () => {
  const chat = thread({
    deepReview: {
      scope: prScope,
      status: "leading",
      statuses: { a: "fixing", b: "fixed" },
      fixing: { m: ["a", "b"] },
    } as unknown as ProjectChat["deepReview"],
  });
  expect(reviveChat(chat, () => false)).toBe(true);
  expect(chat.deepReview).toMatchObject({
    status: "failed",
    statuses: { a: "open", b: "fixed" },
  });
  expect(chat.deepReview?.fixing).toBeUndefined();
});

it("drops worktrees no command of the thread made, and duplicate or unclaimed records", () => {
  const made = message({
    trace: [
      {
        kind: "activity",
        id: "c",
        activity: {
          id: "c",
          kind: "command",
          label: "git worktree add ../mine",
          status: "complete",
        },
      },
    ],
    activity: [{ id: "c", kind: "command", label: "x", status: "complete" }],
    changes: [
      { path: "a.ts" },
      { path: "b.ts", unclaimed: true },
    ] as unknown as ChatMessage["changes"],
  });
  const chat = thread({
    messages: [made],
    agentWorktrees: [
      { path: "/repo/mine", at: 1 },
      { path: "/repo/theirs", at: 1 },
    ],
  });
  expect(reviveChat(chat, () => false)).toBe(true);
  expect(chat.agentWorktrees?.map((w) => w.path)).toEqual(["/repo/mine"]);
  expect(made.activity).toBeUndefined();
  expect(made.changes?.map((f) => f.path)).toEqual(["a.ts"]);
});
