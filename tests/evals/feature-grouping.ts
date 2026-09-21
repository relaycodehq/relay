/** Live counterexample: feature siblings are not repeated edit operations. */
import assert from "node:assert/strict";
import {
  prepareCandidate,
  type Candidate,
} from "../../electron/triage/evidence";
import { classifyChanges } from "../../electron/triage/classifier";
const cases = [
  {
    path: "counter/counter.ts",
    before: "",
    after:
      "export class Counter { value = 0; increment() { this.value++; } }\n",
  },
  {
    path: "counter/counter.html",
    before: "",
    after: '<button (click)="increment()">{{ value }}</button>\n',
  },
  {
    path: "counter/counter.css",
    before: "",
    after: "button { border-radius: 4px; color: blue; padding: 8px; }\n",
  },
  {
    path: "api/one.ts",
    before:
      "export function reportOne(log, value) { log.warn(value); return true; }\n",
    after:
      "export function reportOne(log, value) { log.warning(value); return true; }\n",
  },
  {
    path: "api/two.ts",
    before:
      "export function reportTwo(logger, error) { logger.warn(error); return true; }\n",
    after:
      "export function reportTwo(logger, error) { logger.warning(error); return true; }\n",
  },
  {
    path: "api/mixed.ts",
    before:
      "export function reportMixed(log, value) { log.warn(value); return true; }\n",
    after:
      "export function reportMixed(log, value) { log.warning(value); return false; }\n",
  },
];
const candidates = cases.map(
  (c) =>
    prepareCandidate(
      {
        filename: c.path,
        status: c.before ? "modified" : "added",
        additions: 1,
        deletions: c.before ? 1 : 0,
        changes: 1,
      },
      {
        old: c.before
          ? { name: c.path, contents: c.before, cacheKey: "base" }
          : null,
        next: { name: c.path, contents: c.after, cacheKey: "head" },
        binary: false,
      },
    ) as Candidate,
);
const response = await classifyChanges(
  candidates,
  [],
  new AbortController().signal,
);
assert.deepEqual(response.rejectedFiles, []);
const decisions = new Map(response.result.files.map((f) => [f.path, f]));
const a = decisions.get("api/one.ts")!,
  b = decisions.get("api/two.ts")!;
assert.equal(a.decision, "group");
assert.equal(b.decision, "group");
assert.equal(a.pattern, b.pattern);
assert.equal(decisions.get("api/mixed.ts")!.decision, "normal");
const siblings = cases
  .filter((c) => c.path.startsWith("counter/"))
  .map((c) => decisions.get(c.path)!)
  .filter((f) => f.decision === "group");
assert.equal(
  new Set(siblings.map((f) => f.pattern)).size,
  siblings.length,
  "Feature siblings must have distinct operations",
);
assert.ok(siblings.every((f) => f.pattern !== a.pattern));
console.log(
  JSON.stringify({
    passed: true,
    decisions: response.result.files,
    usage: response.usage,
  }),
);
