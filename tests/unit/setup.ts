import { afterEach, vi } from "vitest";

// Releases build on a Mac mini that runs the suite niced on two workers, where
// a condition that holds within 100 ms here can take seconds. A wait returns as
// soon as its condition holds, so a generous cap costs nothing when it passes;
// set it here once instead of raising it call by call.
const waitFor = vi.waitFor;
vi.waitFor = ((callback, options) =>
  waitFor(
    callback,
    typeof options === "number" ? options : { timeout: 20_000, ...options },
  )) as typeof vi.waitFor;

// React only says that list items share a key as a console error while it
// renders into a DOM, which a passing run scrolls past. Rows sharing a key are
// rebuilt or dropped as the list changes: a thread's messages remounted on
// every streamed piece once, losing the reader's selection and scroll.
const repeatedKeys: string[] = [];
const consoleError = console.error;
console.error = (...args: unknown[]) => {
  if (
    typeof args[0] === "string" &&
    args[0].includes("Encountered two children with the same key")
  )
    repeatedKeys.push(String(args[1]));
  consoleError(...args);
};
afterEach(() => {
  if (!repeatedKeys.length) return;
  const keys = [...new Set(repeatedKeys)].join(", ");
  repeatedKeys.length = 0;
  throw new Error(`React rendered list items sharing a key: ${keys}`);
});
