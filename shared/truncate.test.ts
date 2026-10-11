import { expect, it } from "vitest";
import { promptTitle } from "./prompt-title";
import { sliceWhole, truncated } from "./truncate";

it("never cuts an emoji in half at either end", () => {
  const text = "ab😀cd";
  expect(sliceWhole(text, 0, 3)).toBe("ab");
  expect(sliceWhole(text, 3)).toBe("cd");
  expect(sliceWhole(text, -3)).toBe("cd");
  expect(sliceWhole(text, 0, 4)).toBe("ab😀");
  const title = promptTitle(`${"a".repeat(64)}😀 and more`);
  expect(title).toBe("a".repeat(64));
  expect(truncated("😀".repeat(20), 20).isWellFormed()).toBe(true);
});
