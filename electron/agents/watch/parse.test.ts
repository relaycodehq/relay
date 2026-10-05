import { describe, expect, it } from "vitest";
import { parseNote } from "./parse";

describe("parseNote", () => {
  it("reads nothing to say as no note", () => {
    expect(parseNote("learn: none")).toBeNull();
    expect(parseNote("learn: None.")).toBeNull();
    expect(parseNote("**learn:** none")).toBeNull();
    expect(parseNote("I think everything looks fine.")).toBeNull();
  });

  it("reads a full note, diff and ask included", () => {
    const note =
      parseNote(`learn: The tests subagent made checkout.spec.ts pass by accepting any total.
tag: Heads up
title: The checkout test no longer checks the total
- It compared the total to **42.00**.
- Now it accepts any amount.
diff: tests/checkout.spec.ts
\`\`\`
-  expect(total).toBe("42.00");
+  expect(total).toMatch(/^\\d+\\.\\d{2}$/);
\`\`\`
ask: Put back the exact total and fix the rounding instead.`);
    expect(note).toEqual({
      tag: "Heads up",
      line: "The tests subagent made checkout.spec.ts pass by accepting any total.",
      title: "The checkout test no longer checks the total",
      points: [
        "It compared the total to **42.00**.",
        "Now it accepts any amount.",
      ],
      diff: {
        file: "tests/checkout.spec.ts",
        lines: [
          '-  expect(total).toBe("42.00");',
          "+  expect(total).toMatch(/^\\d+\\.\\d{2}$/);",
        ],
      },
      steer: "Put back the exact total and fix the rounding instead.",
    });
  });

  it("tolerates bold labels, a lead-in and missing optional parts", () => {
    const note = parseNote(`Here is my answer.
**learn:** Retries now apply to every spec.
**tag:** you should know
- One point.
ask: none`);
    expect(note).toEqual({
      tag: "You should know",
      line: "Retries now apply to every spec.",
      title: "Retries now apply to every spec.",
      points: ["One point."],
    });
  });

  it("drops a diff that has no file", () => {
    const note = parseNote("learn: Something.\n```\n+ x\n```");
    expect(note?.diff).toBeUndefined();
  });
});
