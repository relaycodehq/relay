/** Live semantic regression check. Uses the signed-in Codex CLI and consumes model usage. */
import assert from "node:assert/strict";
import {
  prepareCandidate,
  takeBatch,
  type Candidate,
} from "../../electron/triage/evidence";
import {
  classifyChanges,
  type ClassificationResult,
} from "../../electron/triage/classifier";
const cases: {
  path: string;
  before: string;
  after: string;
  expected: string | null;
}[] = [];
for (const suffix of ["one", "two", "mixed"]) {
  const mixed = suffix === "mixed";
  const before = `export function report${suffix}(logger, failure) {\n  logger.warn(failure);\n  return 3;\n}\n`;
  cases.push({
    path: `api/${suffix}.ts`,
    before,
    after: before
      .replace("logger.warn", "logger.warning")
      .replace("return 3", mixed ? "return 8" : "return 3"),
    expected: mixed ? null : "logger-api",
  });
  const config = `service: ${suffix}\ntelemetry:\n  enabled: true\nendpoint: https://example.test/${suffix}\n`;
  cases.push({
    path: `config/${suffix}.yaml`,
    before: config,
    after: config
      .replace("enabled: true", "enabled: false")
      .replace("example.test", mixed ? "another.test" : "example.test"),
    expected: mixed ? null : "telemetry-setting",
  });
  const css = `.${suffix} {\n  padding: 16px;\n  color: red;\n}\n`;
  cases.push({
    path: `styles/${suffix}.css`,
    before: css,
    after: css
      .replace("16px", "var(--space-4)")
      .replace("color: red", mixed ? "color: blue" : "color: red"),
    expected: mixed ? null : "spacing-token",
  });
}
const prepared = cases.map((c) => {
  const candidate = prepareCandidate(
    {
      filename: c.path,
      status: "modified",
      additions: 1,
      deletions: 1,
      changes: 2,
    },
    {
      old: { name: c.path, contents: c.before, cacheKey: "before" },
      next: { name: c.path, contents: c.after, cacheKey: "after" },
      binary: false,
    },
  );
  assert.equal(typeof candidate, "object", c.path);
  return candidate as Candidate;
});
// Put the other examples in a later call to exercise discovery across batches.
const batches = [
  [...prepared.slice(0, 3), ...prepared.slice(6)],
  prepared.slice(3, 6),
];
const known: ClassificationResult["groups"] = [],
  decisions: ClassificationResult["files"] = [];
let tokens = 0;
for (const batch of batches) {
  const response = await classifyChanges(
    batch,
    known,
    new AbortController().signal,
  );
  for (const group of response.result.groups)
    if (!known.some((g) => g.pattern === group.pattern)) known.push(group);
  decisions.push(...response.result.files);
  tokens += response.usage.inputTokens;
  console.log(
    JSON.stringify({
      batch: batch.map((c) => c.path),
      decisions: response.result.files,
      patterns: response.result.groups,
      usage: response.usage,
    }),
  );
}
const unmatched = prepared.filter(
  (c) => decisions.find((d) => d.path === c.path)?.decision === "normal",
);
while (unmatched.length && known.length) {
  const response = await classifyChanges(
    takeBatch(unmatched),
    known,
    new AbortController().signal,
    "match",
  );
  for (const decision of response.result.files)
    decisions.splice(
      decisions.findIndex((d) => d.path === decision.path),
      1,
      decision,
    );
  tokens += response.usage.inputTokens;
  console.log(
    JSON.stringify({
      phase: "matching",
      decisions: response.result.files,
      usage: response.usage,
    }),
  );
}
const groups = new Map<string, string>();
for (const c of cases) {
  const decision = decisions.find((d) => d.path === c.path)!;
  assert.equal(
    decision.decision,
    c.expected ? "group" : "normal",
    `${c.path}: ${decision.reason}`,
  );
  if (!c.expected) continue;
  if (!groups.has(c.expected)) groups.set(c.expected, decision.pattern);
  assert.equal(
    decision.pattern,
    groups.get(c.expected),
    `${c.path} must reuse its matching pattern across batches`,
  );
}
assert.equal(
  new Set(groups.values()).size,
  3,
  "Unrelated transformations must not share a broad group",
);
console.log(
  JSON.stringify({
    passed: cases.length,
    distinctPatterns: groups.size,
    inputTokens: tokens,
  }),
);
