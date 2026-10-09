import { expect, it } from "vitest";
import { inputBlocksThread } from "./thread-state";

it("keeps async questions from blocking a continuing turn but respects live requests", () => {
  expect(inputBlocksThread({ running: true })).toBe(false);
  expect(inputBlocksThread({ running: true, waiting: true })).toBe(true);
  expect(
    inputBlocksThread({ running: true, waiting: true, asking: true }),
  ).toBe(false);
  expect(
    inputBlocksThread({
      running: true,
      waiting: true,
      asking: true,
      blocked: true,
    }),
  ).toBe(true);
  expect(inputBlocksThread({ waiting: true, asking: true })).toBe(true);
  expect(inputBlocksThread({ asking: true })).toBe(false);
});
