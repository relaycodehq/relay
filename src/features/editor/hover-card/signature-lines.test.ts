import { describe, expect, it } from "vitest";
import { oneParamPerLine } from "./signature-lines";

describe("oneParamPerLine", () => {
  it("puts each of several parameters on its own line", () => {
    expect(oneParamPerLine("follow(computerId: string, chatId?: string): Promise<void>")).toBe(
      "follow(\n    computerId: string,\n    chatId?: string,\n): Promise<void>",
    );
  });

  it("leaves a short one-parameter signature on one line", () => {
    expect(oneParamPerLine("trim(text: string): string")).toBe("trim(text: string): string");
  });

  it("splits only at the commas between parameters", () => {
    expect(
      oneParamPerLine('pick(map: Map<string, number>, on: (a: A, b: B) => void, sep = ", ")'),
    ).toBe('pick(\n    map: Map<string, number>,\n    on: (a: A, b: B) => void,\n    sep = ", ",\n)');
  });

  it("starts from the parameter list after the type parameters", () => {
    expect(oneParamPerLine("first<T extends Array<U>, U>(items: T, fallback: U): U")).toBe(
      "first<T extends Array<U>, U>(\n    items: T,\n    fallback: U,\n): U",
    );
  });

  it("leaves a signature the server already broke into lines", () => {
    const pyright = "def follow(\n    self,\n    id: str\n) -> None";
    expect(oneParamPerLine(pyright)).toBe(pyright);
  });
});
