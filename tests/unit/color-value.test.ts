import { expect, it } from "vitest";
import { looksLikeColor } from "../../src/lib/color-value";

it("takes hex and colour functions", () => {
  for (const value of [
    "#1A4165",
    "#fff",
    "#0008",
    "#1a416580",
    "rgb(229 57 53)",
    "rgba(0,0,0,.5)",
    "hsl(38 92% 55%)",
    "oklch(0.72 0.14 250)",
  ])
    expect(looksLikeColor(value), value).toBe(true);
});

it("leaves issue numbers, names and other code alone", () => {
  for (const value of [
    "#123",
    "#4521",
    "red",
    "--accent",
    "#1A416",
    "#main",
    "rgb(var(--x))",
    "src/theme.ts",
  ])
    expect(looksLikeColor(value), value).toBe(false);
});

it("still takes all-digit hex that can't be an issue", () => {
  for (const value of ["#000", "#111", "#0008", "#012345"])
    expect(looksLikeColor(value), value).toBe(true);
});
