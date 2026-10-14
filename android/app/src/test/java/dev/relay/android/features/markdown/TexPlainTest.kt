package dev.relay.android.features.markdown

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** The cases of shared/tex-plain.test.ts. */
class TexPlainTest {
    @Test fun translates() {
        listOf(
            "x" to "x",
            "x^2 + y_1" to "x² + y₁",
            "\\alpha = 0.1" to "α = 0.1",
            "\\theta_{t+1} = \\theta_t - \\alpha \\nabla L" to "θₜ₊₁ = θₜ - α ∇ L",
            "\\frac{a}{b}" to "a/b",
            "\\frac{a+1}{b}" to "(a+1)/b",
            "\\sqrt{x}" to "√x",
            "\\sqrt{x+1}" to "√(x+1)",
            "\\mathbb{R}^n" to "ℝⁿ",
            "\\ell_i + \\hbar" to "ℓᵢ + ℏ",
            "\\sum_{i=1}^n x_i" to "∑ᵢ₌₁ⁿ xᵢ",
            "a \\leq b \\to c" to "a ≤ b → c",
            "\\text{if } x \\in S" to "if x ∈ S",
            "O(n \\log n)" to "O(n log n)",
            "\\hat{x}" to "x̂",
            "e^{i\\pi}" to "e^(iπ)",
            "x^{a+b}" to "x^(a+b)",
        ).forEach { (tex, expected) -> assertEquals(tex, expected, texToPlain(tex)) }
    }

    @Test fun roots() {
        assertEquals("∛x", texToPlain("\\sqrt[3]{x}"))
        assertEquals("∜(x+1)", texToPlain("\\sqrt [4] {x+1}"))
    }

    @Test fun givesUp() {
        listOf(
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
        ).forEach { assertNull(it, texToPlain(it)) }
    }
}
