import { expect, it } from "vitest";
import { cloneProgress } from "./clone";

it("turns git's progress lines into one rising fraction", () => {
  const at = (line: string) => cloneProgress(line)?.progress ?? null;
  const steps = [
    "remote: Counting objects:  50% (5/10)",
    "Receiving objects:   0% (0/120)",
    "Receiving objects:  50% (60/120), 1.2 MiB | 2 MiB/s",
    "Resolving deltas: 100% (40/40), done.",
    "Updating files: 100% (300/300), done.",
  ].map(at);
  expect(steps.every((p) => p !== null)).toBe(true);
  expect([...steps].sort((a, b) => a! - b!)).toEqual(steps);
  expect(steps.at(-1)).toBe(1);
  expect(cloneProgress("Cloning into 'web'...")).toBeNull();
  expect(cloneProgress("remote: Enumerating objects: 5, done.")).toBeNull();
});
