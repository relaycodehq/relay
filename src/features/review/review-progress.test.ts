import { expect, it } from "vitest";
import type { Draft, Progress } from "../../../shared/types";
import {
  afterSubmit,
  putDraft,
  setGroupViewed,
  toggleViewed,
} from "./review-progress";

const progress = (read: Record<string, string>, drafts: Draft[] = []) =>
  ({ read, drafts, marks: [] }) satisfies Progress;
const draft = (id: string, body: string): Draft => ({
  id,
  path: "a.ts",
  line: 1,
  side: "additions",
  body,
  revision: "r2",
  createdAt: "2026-10-01T00:00:00Z",
});

it("toggles a file viewed at this revision, and re-marks one viewed at an older one", () => {
  expect(toggleViewed(progress({}), "a.ts", "r2").read).toEqual({
    "a.ts": "r2",
  });
  expect(toggleViewed(progress({ "a.ts": "r2" }), "a.ts", "r2").read).toEqual(
    {},
  );
  expect(toggleViewed(progress({ "a.ts": "r1" }), "a.ts", "r2").read).toEqual({
    "a.ts": "r2",
  });
});

it("marks a group's files viewed, skipping files it no longer lists and ones with notes", () => {
  const next = setGroupViewed(
    progress({ "c.ts": "r1" }),
    ["a.ts", "b.ts", "c.ts", "gone.ts"],
    ["a.ts", "b.ts", "c.ts"],
    true,
    "r2",
    new Set(["b.ts"]),
  );
  expect(next.read).toEqual({ "a.ts": "r2", "c.ts": "r2" });
});

it("unmarks only the group's files viewed at this revision", () => {
  const next = setGroupViewed(
    progress({ "a.ts": "r2", "b.ts": "r1", "c.ts": "r2" }),
    ["a.ts", "b.ts", "c.ts"],
    ["a.ts", "b.ts", "c.ts"],
    false,
    "r2",
    new Set(["c.ts"]),
  );
  expect(next.read).toEqual({ "b.ts": "r1", "c.ts": "r2" });
});

it("replaces a draft by id, and drops only the published ones after submitting", () => {
  const p = putDraft(
    progress({}, [draft("d1", "old"), draft("d2", "keep")]),
    draft("d1", "new"),
  );
  expect(p.drafts.map((d) => [d.id, d.body])).toEqual([
    ["d2", "keep"],
    ["d1", "new"],
  ]);
  const submitted = afterSubmit({ ...p, reviewBody: "summary" }, ["d1"]);
  expect(submitted.reviewBody).toBe("");
  expect(submitted.drafts.map((d) => d.id)).toEqual(["d2"]);
});
