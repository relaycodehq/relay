import { it, expect } from "vitest";
import { fitCase } from "../../src/components/composer-dictation";

it("fits the model's capital letter to where the words land", () => {
  expect(fitCase("Fix the test.", "Please ")).toBe("fix the test.");
  expect(fitCase("fix the test.", "")).toBe("Fix the test.");
  expect(fitCase("fix the test.", "Done. ")).toBe("Fix the test.");
  expect(fitCase("I think so.", "and ")).toBe("I think so.");
  expect(fitCase("I'll check.", "then ")).toBe("I'll check.");
  // All-caps words are names or acronyms.
  expect(fitCase("CI is red.", "the ")).toBe("CI is red.");
});
