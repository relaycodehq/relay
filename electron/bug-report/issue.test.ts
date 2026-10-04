import { expect, it } from "vitest";
import { issueUrl, urlBudget } from "./issue";

const about = "Relay 1.2.3 · macOS 15.6 arm64 · Electron 44.4.2";
const body = (url: string) => new URL(url).searchParams.get("body")!;
const entry = (i: number) =>
  `2026-10-04T10:00:${String(i % 60).padStart(2, "0")}.000Z error Could not load thread ${i}\n    at load (main.cjs:${i}:1)\n    at next (main.cjs:${i}:2)`;

it("keeps the newest whole entries that fit in a link GitHub accepts", () => {
  const log = Array.from({ length: 400 }, (_, i) => entry(i)).join("\n");
  const url = issueUrl({
    repo: "o/r",
    occasion: { kind: "quit", at: 0, dump: true },
    about,
    log,
  });
  expect(url.length).toBeLessThanOrEqual(urlBudget);
  expect(url.length).toBeGreaterThan(urlBudget - 400);
  expect(new URL(url).searchParams.get("title")).toBe(
    "Relay quit unexpectedly",
  );
  const text = body(url);
  expect(text).toContain("thread 399");
  expect(text).toContain("left a crash dump");
  // Cut at an entry, not halfway down a stack.
  expect(text.split("```\n")[1]).toMatch(/^2026-10-04T/);
});

it("removes secrets and can't be closed early by backticks in the log", () => {
  const text = body(
    issueUrl({
      repo: "o/r",
      occasion: { kind: "asked" },
      about,
      log: "2026-10-04T10:00:00.000Z warn token ghp_abcdefghijklmnopqrstuvwxyz0123456789\n2026-10-04T10:00:01.000Z warn ```js\n",
    }),
  );
  expect(text).not.toContain("ghp_");
  expect(text).toContain("[redacted GitHub token]");
  expect(text).toContain("\n````\n");
});

it("asks for no title when the user opened it", () => {
  const url = issueUrl({
    repo: "o/r",
    occasion: { kind: "asked" },
    about,
    log: "",
  });
  expect(new URL(url).searchParams.has("title")).toBe(false);
  expect(body(url)).toContain("No log yet.");
});
