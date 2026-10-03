import { describe, expect, it } from "vitest";
import { stepEffort } from "./effort-shortcut";
import type { ReasoningEffort } from "../../../shared/settings";

const levels: ReasoningEffort[] = ["low", "medium", "high", "xhigh"];

describe("stepEffort", () => {
  it("steps from the level Default runs", () => {
    expect(stepEffort(levels, "", "high", 1)).toBe("xhigh");
    expect(stepEffort(levels, "", "high", -1)).toBe("medium");
  });
  it("stops at the ends", () => {
    expect(stepEffort(levels, "xhigh", "", 1)).toBe("xhigh");
    expect(stepEffort(levels, "low", "", -1)).toBe("low");
  });
  it("steps from medium when Default's level isn't offered", () => {
    expect(stepEffort(levels, "", "", 1)).toBe("high");
    expect(stepEffort(levels, "", "max", -1)).toBe("low");
  });
});
