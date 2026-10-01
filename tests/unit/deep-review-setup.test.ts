import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../../src/lib/api", () => ({ api: {} }));
import {
  firstSetup,
  reviewBase,
  reviewTarget,
  swapReviewer,
  withOpus,
} from "../../src/lib/deep-review-setup";
import type { ReviewAgent } from "../../shared/deep-review";

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
  });
  vi.stubGlobal("addEventListener", () => {});
});
afterEach(() => vi.unstubAllGlobals());

const choice = {
  model: "gpt-5.5",
  reasoningEffort: "high",
  fast: false,
} as const;
const codex: ReviewAgent = { provider: "codex", choice };

describe("setup", () => {
  it("opens on the project's setup, else the last review's, else a pair", () => {
    const fresh = firstSetup("p1");
    expect(fresh.kind).toBe("uncommitted");
    expect(fresh.reviewers.map((r) => r.provider)).toEqual(["claude", "codex"]);
    store.set(
      "deep-review-setups",
      JSON.stringify([
        {
          id: "s",
          at: 1,
          setup: { reviewers: [codex], lead: codex, runChecks: false },
        },
      ]),
    );
    expect(firstSetup("p1")).toMatchObject({
      kind: "uncommitted",
      reviewers: [codex],
      runChecks: false,
    });
    // A kind this version doesn't know falls back rather than losing the setup.
    store.set(
      "deep-review-setup:p1",
      JSON.stringify({
        kind: "stash",
        base: 3,
        reviewers: [codex, codex],
        lead: codex,
        runChecks: true,
      }),
    );
    expect(firstSetup("p1")).toMatchObject({
      kind: "uncommitted",
      base: "",
      reviewers: [codex, codex],
    });
  });

  it("gives Claude agents on the default model Opus, and only them", () => {
    const claude: ReviewAgent = {
      provider: "claude",
      choice: { ...choice, model: "" },
    };
    const chosen: ReviewAgent = {
      provider: "claude",
      choice: { ...choice, model: "sonnet" },
    };
    const setup = withOpus(
      {
        kind: "uncommitted",
        base: "",
        reviewers: [claude, chosen, codex],
        lead: claude,
        runChecks: true,
      },
      "opus",
    );
    expect(setup.reviewers.map((r) => r.choice.model)).toEqual([
      "opus",
      "sonnet",
      "gpt-5.5",
    ]);
    expect(setup.lead.choice.model).toBe("opus");
  });

  it("keeps a reviewer's prompt only while it stays on the same agent", () => {
    const reviewers: ReviewAgent[] = [{ ...codex, prompt: "$hunt" }, codex];
    expect(
      swapReviewer(reviewers, 0, { ...choice, model: "gpt-5.6" }, "codex")[0],
    ).toEqual({
      provider: "codex",
      choice: { ...choice, model: "gpt-5.6" },
      prompt: "$hunt",
    });
    const swapped = swapReviewer(reviewers, 0, choice, "claude");
    expect(swapped[0]!.prompt).toBe("/code-review");
    expect(swapped[1]).toBe(reviewers[1]);
  });
});

describe("target", () => {
  const branches = [
    { name: "feature", current: true },
    { name: "main", current: false },
    { name: "origin/develop", current: false },
    { name: "zeta", current: false },
  ];
  it("reviews against the chosen base, else the repository's, else another branch", () => {
    expect(reviewBase("zeta", branches, ["main"], "feature").base).toBe("zeta");
    expect(
      reviewBase("gone", branches, ["develop", "main"], "feature").base,
    ).toBe("origin/develop");
    expect(reviewBase("", branches, [], "feature").base).toBe("main");
    expect(reviewBase("main", branches, [], "main").bases).toEqual([
      "origin/develop",
      "zeta",
    ]);
    expect(reviewBase("", [], ["main"]).base).toBeUndefined();
  });

  it("has a target only once it knows everything it needs", () => {
    const none = { changes: 0, pull: null };
    expect(reviewTarget("uncommitted", none)).toBeUndefined();
    expect(reviewTarget("uncommitted", { ...none, changes: 1 })).toEqual({
      kind: "uncommitted",
    });
    expect(reviewTarget("branch", { ...none, base: "main" })).toBeUndefined();
    expect(
      reviewTarget("branch", { ...none, base: "main", branch: "f" }),
    ).toEqual({ kind: "branch", base: "main" });
    expect(reviewTarget("pr", none)).toBeUndefined();
    expect(reviewTarget("commit", { ...none, commit: "abc1234" })).toEqual({
      kind: "commit",
      sha: "abc1234",
    });
  });
});
