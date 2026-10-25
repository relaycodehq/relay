import { describe, expect, it } from "vitest";
import { functionLengths } from "./function-lengths";

const code = (...lines: string[]) => lines.join("\n");

describe("function lengths", () => {
  it("measures declarations, components and methods with long parameter lists", () => {
    const text = code(
      "export function plain() {",
      "  return 1;",
      "}",
      "",
      "const Card = memo(function Card({ a }: Props) {",
      "  return <div />;",
      "});",
      "",
      "class Shells {",
      "  async open(",
      "    deviceId: string,",
      "    cwd: string,",
      "  ): Promise<void> {",
      "    run();",
      "  }",
      "}",
    );
    expect(Object.fromEntries(functionLengths(text))).toEqual({
      plain: 3,
      Card: 3,
      open: 6,
    });
  });

  it("leaves calls and control flow alone", () => {
    const text = code(
      "function outer() {",
      "  useEffect(() => {",
      "    go();",
      "  });",
      "  if (ready) {",
      "    go();",
      "  }",
      "  register(",
      "    a,",
      "  );",
      "}",
    );
    expect(Object.fromEntries(functionLengths(text))).toEqual({ outer: 11 });
  });
});
