import { expect, it, vi } from "vitest";
import { shouldResumeReview } from "../../src/lib/resumeReview";
import type { Pull, Review } from "../../shared/types";

const pull = {
  owner: "team",
  name: "repo",
  number: 1,
  state: "open",
  merged: false,
  head: { sha: "a".repeat(40) },
} as Pull;
const approval = {
  id: 10,
  user: { id: 42, login: "me" },
  state: "APPROVED",
  commit_id: pull.head.sha,
  submitted_at: "2026-09-18T10:00:00Z",
} as Review;
const load = (items: Review[]) =>
  vi.fn(async () => ({ items, nextPage: null }));
it.each([{ state: "closed" }, { merged: true }])(
  "does not resume a finished PR: %j",
  async (state) => {
    const api = load([]);
    expect(await shouldResumeReview({ ...pull, ...state }, 42, api)).toBe(
      false,
    );
    expect(api).not.toHaveBeenCalled();
  },
);
it("uses this user's approval of this head, ignoring ordinary later comments", async () => {
  expect(
    await shouldResumeReview(
      pull,
      42,
      load([approval, { ...approval, id: 11, state: "COMMENT" }]),
    ),
  ).toBe(false);
  expect(await shouldResumeReview(pull, 99, load([approval]))).toBe(true);
});
it.each([{ dismissed: true }, { stale: true }, { commit_id: "b".repeat(40) }])(
  "resumes when the approval no longer applies: %j",
  async (fields) => {
    expect(
      await shouldResumeReview(pull, 42, load([{ ...approval, ...fields }])),
    ).toBe(true);
  },
);
it("checks later pages and orders decisions by submission, not creation id", async () => {
  const api = vi
    .fn()
    .mockResolvedValueOnce({ items: [approval], nextPage: 2 })
    .mockResolvedValueOnce({
      items: [
        {
          ...approval,
          id: 9,
          state: "REQUEST_CHANGES",
          submitted_at: "2026-09-18T11:00:00Z",
        },
      ],
      nextPage: null,
    });
  expect(await shouldResumeReview(pull, 42, api)).toBe(true);
  expect(api).toHaveBeenNthCalledWith(2, pull, 2);
});
it("does not interpret a failed history request as approval", async () => {
  await expect(
    shouldResumeReview(pull, 42, async () => {
      throw new Error("offline");
    }),
  ).rejects.toThrow("offline");
});
