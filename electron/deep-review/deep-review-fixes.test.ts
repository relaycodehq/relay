import { expect, it } from "vitest";
import { settleFixes, startFixing } from "./fixes";
import type { DeepReviewState, Finding } from "../../shared/deep-review";
import type { ProjectChatSend } from "../../shared/projects";

const finding = (id: string): Finding => ({
  id,
  priority: "P1",
  title: id,
  files: [],
  reviewers: [],
});
const review = (): DeepReviewState => ({
  request: "r",
  scope: { target: { kind: "uncommitted" }, label: "", branch: null },
  reviewers: [],
  lead: {
    provider: "claude",
    choice: { model: "", reasoningEffort: "high", fast: false },
  },
  runChecks: false,
  runtimeMode: "full-access",
  status: "done",
  report: {
    findings: [finding("F1"), finding("F2")],
    dropped: [],
    messageId: "m",
  },
  statuses: {},
});
const fix = (id: string, fixes?: string[]) =>
  ({ id, fixes }) as ProjectChatSend;

it("marks only the report's findings as being fixed", () => {
  const state = review();
  startFixing(state, fix("a", ["F1", "F9"]));
  expect(state.statuses).toEqual({ F1: "fixing" });
  expect(state.fixing).toEqual({ a: ["F1"] });
  startFixing(state, fix("b", ["F9"]));
  startFixing(state, fix("c"));
  expect(state.fixing).toEqual({ a: ["F1"] });
});

it("reopens what an unfinished fix was fixing", () => {
  const state = review();
  startFixing(state, fix("a", ["F1", "F2"]));
  expect(settleFixes(state, "a", false)).toBe(true);
  expect(state.statuses).toEqual({ F1: "open", F2: "open" });
  expect(state.fixing).toEqual({});
});

it("leaves a finding an earlier fix settled", () => {
  const state = review();
  startFixing(state, fix("a", ["F1"]));
  startFixing(state, fix("b", ["F1", "F2"]));
  settleFixes(state, "a", true);
  settleFixes(state, "b", false);
  expect(state.statuses).toEqual({ F1: "fixed", F2: "open" });
});

it("ignores answers to anything but a fix request", () => {
  const state = review();
  startFixing(state, fix("a", ["F1"]));
  expect(settleFixes(state, undefined, true)).toBe(false);
  expect(settleFixes(state, "other", true)).toBe(false);
  expect(state.statuses).toEqual({ F1: "fixing" });
});
