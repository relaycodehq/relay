import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import type { DeepReviewState, ReviewScope } from "../../shared/deep-review";
import type { ProjectChat } from "../../shared/projects";
import { fixesFit } from "./rounds";

const round = (scope: Partial<ReviewScope>): DeepReviewState =>
  ({
    request: randomUUID(),
    scope: { target: { kind: "uncommitted" }, label: "", ...scope },
    reviewers: [],
    status: "done",
  }) as unknown as DeepReviewState;
const thread = (reviews: DeepReviewState[], branch?: string) =>
  ({ reviews, ...(branch ? { branch } : {}) }) as ProjectChat;
const pr = (number: number, head: string) =>
  round({
    target: { kind: "pr", ref: { owner: "o", name: "r", number } },
    head,
    checkout: { path: "/wt/deep-reviews/c1", made: true, pr: { number } },
  });

it("won't fix one pull request's findings on another read in the same detached folder", () => {
  const [seven, eight] = [pr(7, "a7"), pr(8, "b8")];
  const chat = thread([seven, eight]);
  expect(fixesFit(chat, seven, eight)).toBe(false);
  expect(fixesFit(chat, pr(8, "c8"), eight)).toBe(true);
});

it("fixes a round that made no checkout while the round it ran under still holds the thread, wherever that went", () => {
  const panel = round({
    target: { kind: "branch", head: "panel", base: "main" },
    head: "p1",
    checkout: { path: "/elsewhere/panel", made: false, branch: "panel" },
  });
  const edits = round({ folder: "/wt/deep-reviews/c1", branch: "panel" });
  const queue = round({
    target: { kind: "branch", head: "queue", base: "main" },
    head: "q1",
    checkout: { path: "/wt/deep-reviews/c1", made: true, branch: "queue" },
  });
  expect(fixesFit(thread([panel, edits]), edits, panel)).toBe(true);
  expect(fixesFit(thread([panel, edits, queue]), edits, queue)).toBe(false);
});

it("fixes another thread's round only while the thread is on the branch it reviewed", () => {
  const edits = round({ folder: "/repo", branch: "panel" });
  expect(fixesFit(thread([edits], "panel"), edits, undefined)).toBe(true);
  expect(fixesFit(thread([edits], "queue"), edits, undefined)).toBe(false);
});
