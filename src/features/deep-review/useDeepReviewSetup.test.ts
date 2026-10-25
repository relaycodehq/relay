import { beforeEach, expect, it, vi } from "vitest";
vi.mock("../../lib/api", () => ({ api: {} }));
import { threadStorage } from "../../lib/thread-storage";
import type { Setup } from "./deep-review-setup";
import { keepReview } from "./useDeepReviewSetup";

const store = new Map<string, string>();

beforeEach(() => {
  store.clear();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() {
      return store.size;
    },
  });
});

const agent = (provider: string) => ({
  provider,
  choice: { model: "m", reasoningEffort: "high", fast: false },
});

const setupOf = (kind: Setup["kind"], reviewers: number) =>
  ({
    kind,
    reviewers: Array.from({ length: reviewers }, () => agent("codex")),
    lead: agent("claude"),
    runChecks: true,
  }) as Setup;

it("a note keeps the setup it was written with when the project's moves on", () => {
  const mine = setupOf("branch", 2);
  keepReview("p1", "new:p1", mine, { focus: "the queue" });
  // Another review edits the project's setup afterwards.
  store.set("deep-review-setup:p1", JSON.stringify(setupOf("commit", 1)));
  expect(threadStorage("new:p1").review.load().setup).toEqual(mine);
});

it("clearing the note of an untouched setup leaves no draft", () => {
  const plain = setupOf("branch", 2);
  store.set("deep-review-setup:p1", JSON.stringify(plain));
  keepReview("p1", "new:p1", plain, { focus: "the queue" });
  keepReview("p1", "new:p1", plain, { focus: undefined });
  expect(threadStorage("new:p1").review.load()).toEqual({});
});
