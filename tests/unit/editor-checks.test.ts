import { expect, it } from "vitest";
import type { ProjectCheckState, ProjectDiagnostic } from "../../shared/checks";
import { checkStatus, problemMarkers } from "../../src/lib/editor-checks";

const counts = { errors: 0, warnings: 0, suggestions: 0 };
const state = (
  status: ProjectCheckState["status"],
  files: ProjectCheckState["files"] = {},
  message?: string,
) =>
  ({
    ...counts,
    id: "1",
    head: "h",
    status,
    files,
    diagnostics: [],
    message,
  }) as unknown as ProjectCheckState;

it("says where the checks stand on this buffer", () => {
  const file = (errors = 0) => ({ "a.ts": { ...counts, errors, hash: "x" } });
  expect(checkStatus(state("failed", file(), "tsc crashed"), "a.ts", "x")).toBe(
    "tsc crashed",
  );
  expect(checkStatus(state("ready", file(2)), "a.ts", "x")).toBe(
    "2 errors · 0 warnings",
  );
  expect(checkStatus(state("ready", file()), "a.ts", "x")).toBe(
    "No compiler errors in this file",
  );
  expect(checkStatus(state("ready", file()), "b.ts", "x")).toBe(
    "This file is outside the selected compiler configuration",
  );
});

it("waits while the checks are of an older buffer or still running", () => {
  const files = { "a.ts": { ...counts, errors: 1, hash: "old" } };
  for (const [s, hash] of [
    [state("ready", files), "new"],
    [state("ready", files), undefined],
    [state("checking", files), "old"],
    [undefined, "old"],
  ] as const)
    expect(checkStatus(s, "a.ts", hash)).toBe("Checking live buffer…");
});

it("marks placed problems zero-based, errors last, at least one character wide", () => {
  const d = (
    severity: ProjectDiagnostic["severity"],
    rest: Partial<ProjectDiagnostic>,
  ): ProjectDiagnostic => ({
    severity,
    code: "TS1",
    message: severity,
    ...rest,
  });
  expect(
    problemMarkers([
      d("error", { line: 3, column: 5 }),
      d("warning", { line: 1, column: 2, endLine: 2, endColumn: 4 }),
      d("info", { line: 1 }),
      d("error", {}),
    ]),
  ).toEqual([
    {
      start: { line: 0, character: 1 },
      end: { line: 1, character: 3 },
      severity: "warning",
      message: "warning",
      source: "TS1",
    },
    {
      start: { line: 2, character: 4 },
      end: { line: 2, character: 5 },
      severity: "error",
      message: "error",
      source: "TS1",
    },
  ]);
});
