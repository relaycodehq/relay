import { vi } from "vitest";

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
