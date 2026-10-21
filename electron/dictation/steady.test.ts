import { expect, it } from "vitest";
import { afterSettled, collapseRepeats, SteadyWords } from "./steady";

it("keeps a shown word until two decodes in a row agree it changed", () => {
  const steady = new SteadyWords();
  expect(steady.next("it's much better you did", "")).toBe(
    "it's much better you did",
  );
  // A one-off guess doesn't flip what's shown, but new words at the end do.
  expect(steady.next("it's much better if you did a", "")).toBe(
    "it's much better you did a",
  );
  expect(steady.next("it's better you did a good job", "")).toBe(
    "it's much better you did a good job",
  );
  // Agreeing with the decode before it, this one is shown as it is.
  expect(steady.next("it's better you did a good job at", "")).toBe(
    "it's better you did a good job at",
  );
});

it("lets a word cut off at the end finish without keeping both", () => {
  const steady = new SteadyWords();
  steady.next("so when the ch", "");
  steady.next("so when the ch", "");
  expect(steady.next("so when the changes happen", "")).toBe(
    "so when the changes happen",
  );
});

it("drops words as they settle off the start", () => {
  const steady = new SteadyWords();
  steady.next("much better than it was before", "");
  expect(steady.next("than it was before ah", "much better")).toBe(
    "than it was before ah",
  );
});

it("drops a word said twice in a row, keeping its punctuation", () => {
  expect(collapseRepeats("see how how your words jumps jumps.")).toBe(
    "see how your words jumps.",
  );
  expect(collapseRepeats("Okay, okay so")).toBe("Okay, so");
  expect(afterSettled("it often jumps", "jumps in the timeline")).toBe(
    "in the timeline",
  );
  expect(afterSettled("it often", "jumps in")).toBe("jumps in");
});
