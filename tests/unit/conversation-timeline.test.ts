import { describe, expect, it } from "vitest";
import { conversationTimeline } from "../../src/lib/conversation-timeline";
import type { Discussion, Review, ReviewComment } from "../../shared/types";

const user = (login: string) => ({ id: 1, login }) as Review["user"];
const review = (id: number, over: Partial<Review> = {}): Review => ({
  id,
  body: "",
  state: "COMMENT",
  user: user("jan"),
  submitted_at: `2026-09-0${id}T10:00:00Z`,
  commit_id: "head",
  comments_count: 0,
  ...over,
});
const line = (id: number, reviewId: number): ReviewComment => ({
  id,
  body: `line ${id}`,
  path: "src/a.ts",
  position: 3,
  original_position: 3,
  commit_id: "head",
  user: user("jan"),
  created_at: `2026-09-0${reviewId}T10:00:00Z`,
  html_url: "",
  pull_request_review_id: reviewId,
});
const talk = (id: number, day: number): Discussion => ({
  id,
  body: `talk ${id}`,
  user: user("sam"),
  created_at: `2026-09-0${day}T12:00:00Z`,
  html_url: "",
});

describe("conversationTimeline", () => {
  it("puts Gitea's body-less single-comment reviews' line comments inside them", () => {
    const entries = conversationTimeline(
      [review(1, { comments_count: 1 }), review(2, { comments_count: 1 })],
      [line(10, 1), line(20, 2)],
      [],
    );
    expect(
      entries.map((e) => e.kind === "review" && e.comments.map((c) => c.id)),
    ).toEqual([[10], [20]]);
  });

  it("drops reviews with nothing to show but keeps bare verdicts", () => {
    const entries = conversationTimeline(
      [
        review(1),
        review(2, { state: "REQUEST_REVIEW" }),
        review(3, { state: "APPROVED" }),
        review(4, { body: "  " }),
        review(5, { body: "Looks off" }),
      ],
      [],
      [],
    );
    expect(entries.map((e) => e.kind === "review" && e.review.id)).toEqual([
      3, 5,
    ]);
  });

  it("interleaves reviews and plain comments by time, undated last", () => {
    const entries = conversationTimeline(
      [
        review(3, { body: "r3" }),
        review(1, { body: "r1" }),
        review(9, { body: "undated", submitted_at: "" }),
      ],
      [],
      [talk(100, 2), talk(101, 4)],
    );
    expect(
      entries.map((e) =>
        e.kind === "review" ? `r${e.review.id}` : `d${e.comment.id}`,
      ),
    ).toEqual(["r1", "d100", "r3", "d101", "r9"]);
  });
});
