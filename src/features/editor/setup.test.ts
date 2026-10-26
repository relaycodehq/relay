import { expect, it } from "vitest";
import { detectIndent } from "./setup";

it("takes the file's indent from its code, not its doc comments", () => {
  const text = "/**\n * A thing.\n */\nfunction a() {\n    return 1;\n}\n";
  expect(detectIndent(text)).toBe("    ");
  expect(detectIndent("if (a) {\n  b();\n}\n")).toBe("  ");
  expect(detectIndent("if (a) {\n\tb();\n}\n")).toBe("\t");
});
