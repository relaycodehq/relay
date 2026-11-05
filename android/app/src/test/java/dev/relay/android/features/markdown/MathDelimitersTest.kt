package dev.relay.android.features.markdown

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.random.Random

/** The cases of shared/math-delimiters.test.ts. */
class MathDelimitersTest {
    @Test fun rewrites() {
        listOf(
            "so \\(x^2\\) holds" to "so $\$x^2$$ holds",
            "so \\[a_1 + b\\] holds" to "so $\$a_1 + b$$ holds",
            "so \\[\\sigma\\] holds" to "so $$\\sigma$$ holds",
            "so \$x_1$ and $\\alpha$." to "so $\$x_1$$ and $$\\alpha$$.",
            "It costs $5 and $10, and \$x_1$ is free." to "It costs $5 and $10, and $\$x_1$$ is free.",
            "$$ E = mc^2 $$" to "$$\nE = mc^2\n$$",
            "\\[ E = mc^2 \\]" to "$$\nE = mc^2\n$$",
            "\\[\n a &= b \\\\\n c &= d\n\\]" to "$$\n a &= b \\\\\n c &= d\n$$",
            "$$ \\begin{aligned}\na &= b\n\\end{aligned} $$" to "$$\n\\begin{aligned}\na &= b\n\\end{aligned}\n$$",
            "> \\[\n> x^2\n> \\]" to "> $$\n> x^2\n> $$",
        ).forEach { (input, expected) -> assertEquals(input, expected, normalizeMath(input)) }
    }

    @Test fun leavesProseAlone() {
        listOf(
            "It costs $5 and then $10.",
            "Between $5-$10 or $3 to $5.",
            "Set \$HOME/\$USER and \$PATH:\$HOME.",
            "The script sets cost=\$cost, total=\$total first.",
            "Routes match /^\\d+$/ and /^\\w+$/ for ids.",
            "Read \$a+\$b and \$x^\$y, then \$f(\$g).",
            "A \\$5 fee and \\\$x\\$.",
            "Tag \\[WIP\\] and \\[draft\\].",
            "Match \\[\\d+\\] or \\[\\w{2,4}\\.\\s\\] in the log.",
            "Already $\$x$$ inline stays.",
            "`\$x\$` and ``\\(x\\)`` are code",
            "```\n\$x$\n\\[\n$$\n```",
        ).forEach { assertEquals(it, it, normalizeMath(it)) }
    }

    @Test fun escapesProseStartingWithDollars() {
        assertEquals("\\$$ is the PID of the shell", normalizeMath("$$ is the PID of the shell"))
    }

    @Test fun keepsStreamingFormula() {
        assertEquals("Intro\n\n$$\n\\frac{a}{", normalizeMath("Intro\n\n$$\n\\frac{a}{"))
        assertEquals("$$\nx = \\frac{", normalizeMath("\\[\nx = \\frac{"))
    }

    @Test fun unclosedBracketDoesNotSwallow() {
        val text = "\\[WIP] first\n\nthen prose\n\nand more"
        assertEquals(text, normalizeMath(text))
    }

    @Test fun idempotent() {
        listOf(
            "a \\(x\\) b \$y_2$ c\n\n\\[\nz\n\\]\n\n$$\nw\n$$",
            "> $$ x $$\n\n- \\[ a^2 \\]",
            "$$\nunfinished",
        ).forEach { assertEquals(normalizeMath(it), normalizeMath(normalizeMath(it))) }
    }

    @Test fun readsALongLineOfUnclosedOpenersInLinearTime() {
        for (text in listOf("x " + "\\( a".repeat(20_000), "x " + "\\(".repeat(25_000), "x " + "\\[a".repeat(20_000))) {
            val started = System.nanoTime()
            assertEquals(text, normalizeMath(text))
            val ms = (System.nanoTime() - started) / 1_000_000
            assertTrue("took ${ms}ms", ms < 500)
        }
    }

    @Test fun pairsAnOpenerWithTheCloserAfterTheLastOpener() {
        assertEquals("a \\( b $\$x^2$$ c", normalizeMath("a \\( b \\(x^2\\) c"))
        assertEquals("a \\[ b $\$x_1$$ c", normalizeMath("a \\[ b \\[x_1\\] c"))
        assertEquals("a $\$\\)x$$ b", normalizeMath("a \\(\\)x\\) b"))
    }

    @Test fun scansInlineFormulasAsTheDesktopsRegexDoes() {
        // shared/math-delimiters.ts's INLINE_PARENS and INLINE_BRACKETS.
        val desktop = listOf(
            Triple("\\(", "\\)", Regex("""\\\(((?:(?!\\\().)+?)\\\)""")),
            Triple("\\[", "\\]", Regex("""\\\[((?:(?!\\\[).)+?)\\\]""")),
        )
        val pieces = listOf("\\(", "\\)", "\\[", "\\]", "\\", "(", ")", "[", "]", "x", "^2", " ")
        val random = Random(7)
        repeat(50_000) {
            val line = buildString { repeat(random.nextInt(12)) { append(pieces.random(random)) } }
            for ((opener, closer, regex) in desktop) {
                val expected = regex.replace(line) { "<" + it.groupValues[1] + ">" }
                assertEquals(line, expected, replaceInline(line, opener, closer) { _, tex -> "<$tex>" })
            }
        }
    }
}
