import { it, expect } from "vitest";
import { fitCase, placeDictation } from "./dictation";

it("fits the model's capital letter to where the words land", () => {
  expect(fitCase("Fix the test.", "Please ")).toBe("fix the test.");
  expect(fitCase("fix the test.", "")).toBe("Fix the test.");
  expect(fitCase("fix the test.", "Done. ")).toBe("Fix the test.");
  expect(fitCase("I think so.", "and ")).toBe("I think so.");
  expect(fitCase("I'll check.", "then ")).toBe("I'll check.");
  // All-caps words are names or acronyms.
  expect(fitCase("CI is red.", "the ")).toBe("CI is red.");
});

it("spaces words dictated into plain text from what's around them", () => {
  expect(placeDictation("Please", 6, 6, "Fix the test")).toEqual({
    text: "Please fix the test",
    start: 7,
    end: 19,
  });
  expect(placeDictation("Done.then", 5, 5, "check it").text).toBe(
    "Done. Check it then",
  );
  expect(placeDictation("fix it.", 3, 3, "the test").text).toBe(
    "fix the test it.",
  );
  expect(placeDictation("fix\n.", 4, 4, "Tests").text).toBe("fix\nTests.");
  expect(placeDictation("a  b", 1, 3, "").text).toBe("ab");
});
