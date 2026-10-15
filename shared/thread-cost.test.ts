import { describe, expect, it } from "vitest";
import type { ChatMessage } from "./projects/messages";
import { formatCost, threadCost } from "./thread-cost";

const answer = (cost: number | undefined, model?: string) =>
  ({
    id: Math.random().toString(),
    role: "assistant",
    body: "",
    created: 0,
    version: 0,
    status: "complete",
    ...(cost === undefined ? {} : { cost }),
    ...(model ? { model: { name: model, effort: "" } } : {}),
  }) as ChatMessage;

describe("threadCost", () => {
  it("has nothing to show for a plan or free model, which price at $0", () => {
    expect(threadCost([answer(0, "glm-5.1"), answer(undefined)])).toBeUndefined();
  });

  it("sums billed answers per model, most expensive first", () => {
    const cost = threadCost([
      answer(0.01, "gpt-6-luna"),
      answer(0.2, "claude-sonnet-5.5"),
      answer(0, "glm-5.1"),
      answer(0.18, "claude-sonnet-5.5"),
      answer(0.03, "gpt-6-luna"),
    ]);
    expect(cost?.answers).toBe(4);
    expect(cost?.usd).toBeCloseTo(0.42);
    expect(cost?.models.map((m) => m.name)).toEqual([
      "claude-sonnet-5.5",
      "gpt-6-luna",
    ]);
  });

  it("says less than a cent rather than $0.00", () => {
    expect(formatCost(0.004)).toBe("<$0.01");
    expect(formatCost(0.4218)).toBe("$0.42");
  });

  it("drops cents on big amounts", () => {
    expect(formatCost(3.0612)).toBe("$3.06");
    expect(formatCost(145.3)).toBe("$145");
    expect(formatCost(1098.35)).toBe("$1,098");
    expect(formatCost(50)).toBe("$50");
  });
});
