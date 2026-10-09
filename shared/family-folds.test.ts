import { describe, expect, it } from "vitest";
import { parseFamilyFolds, withFamilyFold } from "./family-folds";

describe("family folds", () => {
  it("keeps only true/false entries from what was saved", () => {
    expect(parseFamilyFolds({ a: false, b: true, c: "yes", d: 1 })).toEqual({ a: false, b: true });
    expect(parseFamilyFolds(null)).toEqual({});
    expect(parseFamilyFolds("folded")).toEqual({});
  });

  it("replaces a lead's fold and keeps the newest 200", () => {
    let folds = {};
    for (let i = 0; i < 205; i++) folds = withFamilyFold(folds, `lead-${i}`, false);
    expect(Object.keys(folds)).toHaveLength(200);
    expect(folds).not.toHaveProperty("lead-0");
    // Toggling an old one again makes it newest, so it survives the next trim.
    folds = withFamilyFold(folds, "lead-5", true);
    for (let i = 205; i < 404; i++) folds = withFamilyFold(folds, `lead-${i}`, false);
    expect(folds).toHaveProperty("lead-5", true);
  });
});
