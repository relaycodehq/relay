import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../../lib/api", () => ({ api: {} }));
import {
  firstSetup,
  reviewBranches,
  reviewTarget,
  swapReviewer,
  withOpus,
} from "./deep-review-setup";
import type { ReviewAgent } from "../../../shared/deep-review";

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
  const pick = (
    head: string,
    base: string,
    checkedOut?: string,
    usual: string[] = [],
  ) => reviewBranches({ head, base }, branches, usual, checkedOut);
  it("reviews against the chosen base, else the repository's, else another branch", () => {
    expect(pick("", "zeta", "feature", ["main"]).base).toBe("zeta");
    expect(pick("", "gone", "feature", ["develop", "main"]).base).toBe(
      "origin/develop",
    );
    expect(pick("", "", "feature").base).toBe("main");
    expect(
      reviewBranches({ head: "", base: "" }, [], ["main"]).base,
    ).toBeUndefined();
    expect(pick("", "", "feature", ["main", "develop"]).bases).toEqual([
      "main",
      "origin/develop",
      "zeta",
    ]);
  });

  it("reviews the checked-out branch unless another is chosen, never into itself", () => {
    expect(pick("", "main", "feature")).toMatchObject({
      head: "feature",
      base: "main",
    });
    // On main, another branch reviewed into main, which is checked out.
    expect(pick("zeta", "main", "main")).toMatchObject({
      head: "zeta",
      base: "main",
    });
    expect(pick("zeta", "main", "main").bases).not.toContain("zeta");
    // Choosing the base as the branch to review moves the base on.
    expect(pick("main", "main", "feature")).toMatchObject({
      head: "main",
      base: "feature",
    });
    // A chosen branch that's gone falls back to the checkout.
    expect(pick("gone", "main", "feature").head).toBe("feature");
  });

  it("has no branch to review in a detached checkout until one is chosen", () => {
    const detached = pick("", "", undefined, ["main"]);
    expect(detached).toMatchObject({ head: undefined, base: "main" });
    expect(
      reviewTarget("branch", { changes: 0, pull: null, ...detached }),
    ).toBeUndefined();
    expect(pick("zeta", "", undefined, ["main"]).head).toBe("zeta");
  });

  it("has a target only once it knows everything it needs", () => {
    const none = { changes: 0, pull: null };
    expect(reviewTarget("uncommitted", none)).toBeUndefined();
    expect(reviewTarget("uncommitted", { ...none, changes: 1 })).toEqual({
      kind: "uncommitted",
    });
    expect(reviewTarget("branch", { ...none, base: "main" })).toBeUndefined();
    expect(
      reviewTarget("branch", { ...none, base: "main", head: "f" }),
    ).toEqual({ kind: "branch", head: "f", base: "main" });
    expect(
      reviewTarget("branch", { ...none, base: "main", head: "main" }),
    ).toBeUndefined();
    expect(reviewTarget("pr", none)).toBeUndefined();
    expect(reviewTarget("commit", { ...none, commit: "abc1234" })).toEqual({
      kind: "commit",
      sha: "abc1234",
    });
  });
});
