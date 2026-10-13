import { expect, it } from "vitest";
import {
  reopenFixes,
  setFindingStatus,
  settleFixes,
  startFixing,
} from "./fixes";
import type { Finding, ThreadFindings } from "../../shared/findings";
import type { ProjectChatSend } from "../../shared/projects";

const finding = (id: string): Finding => ({
  id,
  priority: "P1",
  title: id,
  files: [],
  reviewers: [],
});
const thread = (): ThreadFindings => ({
  reports: [
    { findings: [finding("F1"), finding("F2")], dropped: [], messageId: "m" },
  ],
  statuses: {},
});
const fix = (id: string, fixes?: string[]) =>
  ({ id, fixes }) as ProjectChatSend;

it("marks only the thread's findings as being fixed", () => {
  const findings = thread();
  startFixing(findings, fix("a", ["F1", "F9"]));
  expect(findings.statuses).toEqual({ F1: "fixing" });
  expect(findings.fixing).toEqual({ a: ["F1"] });
  startFixing(findings, fix("b", ["F9"]));
  startFixing(findings, fix("c"));
  expect(findings.fixing).toEqual({ a: ["F1"] });
});

it("reopens what an unfinished fix was fixing", () => {
  const findings = thread();
  startFixing(findings, fix("a", ["F1", "F2"]));
  expect(settleFixes(findings, "a", false)).toBe(true);
  expect(findings.statuses).toEqual({ F1: "open", F2: "open" });
  expect(findings.fixing).toEqual({});
});

it("leaves a finding an earlier fix settled", () => {
  const findings = thread();
  startFixing(findings, fix("a", ["F1"]));
  startFixing(findings, fix("b", ["F1", "F2"]));
  settleFixes(findings, "a", true);
  settleFixes(findings, "b", false);
  expect(findings.statuses).toEqual({ F1: "fixed", F2: "open" });
});

it("ignores answers to anything but a fix request", () => {
  const findings = thread();
  startFixing(findings, fix("a", ["F1"]));
  expect(settleFixes(findings, undefined, true)).toBe(false);
  expect(settleFixes(findings, "other", true)).toBe(false);
  expect(settleFixes(undefined, "a", true)).toBe(false);
  expect(findings.statuses).toEqual({ F1: "fixing" });
});

it("reopens a fix the app closed on", () => {
  const findings = thread();
  startFixing(findings, fix("a", ["F1"]));
  expect(reopenFixes(findings)).toBe(true);
  expect(findings).toMatchObject({ statuses: { F1: "open" } });
  expect(findings.fixing).toBeUndefined();
  expect(reopenFixes(findings)).toBe(false);
});

it("won't set a finding that's being fixed or isn't there", () => {
  const findings = thread();
  expect(setFindingStatus(findings, "F2", "dismissed")).toBe("m");
  startFixing(findings, fix("a", ["F1"]));
  expect(() => setFindingStatus(findings, "F1", "dismissed")).toThrow(
    "fixing this one",
  );
  expect(() => setFindingStatus(findings, "F7", "open")).toThrow(
    "no longer in this thread",
  );
});
