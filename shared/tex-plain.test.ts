import { describe, expect, it } from "vitest";
import { texToPlain } from "./tex-plain";

describe("texToPlain", () => {
  it.each([
    ["x", "x"],
    ["x^2 + y_1", "x² + y₁"],
    ["\\alpha = 0.1", "α = 0.1"],
    ["\\theta_{t+1} = \\theta_t - \\alpha \\nabla L", "θₜ₊₁ = θₜ - α ∇ L"],
    ["\\frac{a}{b}", "a/b"],
    ["\\frac{a+1}{b}", "(a+1)/b"],
    ["\\sqrt{x}", "√x"],
    ["\\sqrt{x+1}", "√(x+1)"],
    ["\\mathbb{R}^n", "ℝⁿ"],
    ["\\ell_i + \\hbar", "ℓᵢ + ℏ"],
    ["\\sum_{i=1}^n x_i", "∑ᵢ₌₁ⁿ xᵢ"],
    ["a \\leq b \\to c", "a ≤ b → c"],
    ["\\text{if } x \\in S", "if x ∈ S"],
    ["O(n \\log n)", "O(n log n)"],
    ["\\hat{x}", "x̂"],
    ["e^{i\\pi}", "e^(iπ)"],
    ["x^{a+b}", "x^(a+b)"],
  ])("%s", (tex, expected) => {
    expect(texToPlain(tex)).toBe(expected);
  });

  it("writes cube and fourth roots with their own signs", () => {
    expect(texToPlain("\\sqrt[3]{x}")).toBe("∛x");
    expect(texToPlain("\\sqrt [4] {x+1}")).toBe("∜(x+1)");
  });

  it.each([
    "\\begin{pmatrix} a & b \\end{pmatrix}",
    "a \\\\ b",
    "\\unknownmacro{x}",
    "\\mathbb{X}",
    "\\sqrt[n]{x}",
    "\\toString x",
    "\\hasOwnProperty{x}",
    "\\mathbb{constructor}",
    "x^",
    "{a",
    "a}",
  ])("gives up on %s so the source shows instead", (tex) => {
    expect(texToPlain(tex)).toBeNull();
  });
});
