import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import {
  accountKeys,
  idKeys,
  secretKeys,
  // @ts-expect-error A plain module of patterns.
} from "../record/redact-keys.mjs";

// Recorded agent transcripts are public once committed. This checks them on
// its own, whatever tests/record/redact.mjs did or missed, and the same on any
// computer: who recorded them is redact.mjs's to look for.
const root = "tests/fixtures/replays";
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory()
      ? files(path)
      : name.endsWith(".jsonl")
        ? [path]
        : [];
  });

const leaks: [string, RegExp][] = [
  ["a home folder", /\/(Users|home)\/(?!replay\b)[^/"\\]+/],
  ["a temp folder", /\/(private\/)?var\/folders\/|-(private-)?var-folders-/],
  ["a home folder as a project name", /-Users-(?!replay\b)[^-"\\]+/],
  ["a computer's name", /\b(?!replay\b)[A-Za-z0-9-]+\.local\b/],
  [
    "an email",
    /[A-Za-z0-9._%+-]+@(?!(example|anthropic|openai)\.com)[A-Za-z0-9.-]+\.[A-Za-z]{2,}/,
  ],
  ["an API key", /sk-(ant-)?[A-Za-z0-9_-]{16,}/],
  ["a GitHub token", /\b(ghp|gho|ghu|ghs|github_pat)_[A-Za-z0-9_]{16,}/],
  ["a JWT", /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
  ["a bearer token", /Bearer\s+(?!REDACTED)[A-Za-z0-9._~+/-]{12,}/],
  [
    "something synced from claude.ai",
    /\(claude\.ai sync\)|"claudeai"|mcp__claude_ai_/,
  ],
];

/** Keys that hold an id, a secret or the account's details with anything but a placeholder. */
function keyLeaks(value: unknown, found: string[] = []): string[] {
  if (Array.isArray(value)) value.forEach((v) => keyLeaks(v, found));
  else if (value && typeof value === "object")
    for (const [key, v] of Object.entries(value)) {
      const kept =
        v === null ||
        v === "" ||
        (idKeys.test(key) && v === "replay-id") ||
        (secretKeys.test(key) && v === "REDACTED") ||
        (accountKeys.test(key) && v === "replay");
      if (
        typeof v !== "object" &&
        !kept &&
        (idKeys.test(key) ||
          accountKeys.test(key) ||
          (secretKeys.test(key) && typeof v === "string"))
      )
        found.push(key);
      keyLeaks(v, found);
    }
  return found;
}
const lines = (text: string) =>
  text
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      const entry = JSON.parse(line) as { line?: string };
      try {
        return entry.line === undefined
          ? [entry]
          : [entry, JSON.parse(entry.line)];
      } catch {
        return [entry];
      }
    });

it("keeps paths, names, emails and keys out of the recorded transcripts", () => {
  const found = files(root).flatMap((file) => {
    const text = readFileSync(file, "utf8");
    return [
      ...leaks
        .filter(([, pattern]) => pattern.test(text))
        .map(([what]) => what),
      ...new Set(
        lines(text)
          .flatMap((m) => keyLeaks(m))
          .map((key) => `"${key}"`),
      ),
    ].map((what) => `${file}: ${what}`);
  });
  expect(found).toEqual([]);
});
