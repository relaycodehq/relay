package dev.relay.android.features.markdown

import org.junit.Assert.assertEquals
import org.junit.Assert.assertSame
import org.junit.Test

class MarkdownModelTest {
    private fun plain(text: String) = MdInline.Plain(text)

    @Test fun displayMathClosesOrStreams() {
        // The cases of mobile/src/ui/math/marked-math.test.ts, through the parser.
        assertEquals(listOf(MdBlock.Math("a^2\n+ b", true)), parseMarkdown("$$\na^2\n+ b\n$$"))
        assertEquals(
            listOf(MdBlock.Para(listOf(plain("Intro"))), MdBlock.Math("\\frac{a}{", false)),
            parseMarkdown("Intro\n\n$$\n\\frac{a}{"),
        )
        assertEquals(
            listOf(MdBlock.Quote(listOf(MdBlock.Math("x^2", true)))),
            parseMarkdown("> \\[\n> x^2\n> \\]"),
        )
    }

    @Test fun inlineMath() {
        assertEquals(
            listOf(MdBlock.Para(listOf(plain("so "), MdInline.Math("x^2"), plain(" holds")))),
            parseMarkdown("so \\(x^2\\) holds"),
        )
        assertEquals(listOf(MdBlock.Para(listOf(plain("It costs $5 and $10.")))), parseMarkdown("It costs $5 and $10."))
        assertEquals(
            listOf(MdBlock.Para(listOf(MdInline.Code("\$x$")))),
            parseMarkdown("`\$x$`"),
        )
    }

    @Test fun listsTasksAndTables() {
        val blocks = parseMarkdown("- [x] done\n- [ ] todo\n\n3. three\n4. four\n\n| a | b |\n|---|---|\n| 1 | **2** |")
        assertEquals(
            MdBlock.Items(
                false,
                1,
                listOf(
                    Item(true, listOf(MdBlock.Para(listOf(plain("done"))))),
                    Item(false, listOf(MdBlock.Para(listOf(plain("todo"))))),
                ),
            ),
            blocks[0],
        )
        assertEquals(3, (blocks[1] as MdBlock.Items).start)
        assertEquals(
            MdBlock.Table(
                listOf(listOf(plain("a")), listOf(plain("b"))),
                listOf(listOf(listOf(plain("1")), listOf(MdInline.Strong(listOf(plain("2")))))),
            ),
            blocks[2],
        )
    }

    @Test fun codeImagesAndLinks() {
        val blocks = parseMarkdown("```kotlin title\nval x = 1\n```\n\nSee ![shot](/tmp/a.png) and [docs](https://x.dev) &amp; www.example.com")
        assertEquals(MdBlock.Code("kotlin", "val x = 1"), blocks[0])
        val inlines = (blocks[1] as MdBlock.Para).inlines
        assertEquals(MdInline.Image("/tmp/a.png", "shot"), inlines[1])
        assertEquals(MdInline.Link("https://x.dev", listOf(plain("docs"))), inlines[3])
        assertEquals(plain(" & "), inlines[4])
        assertEquals("http://www.example.com", (inlines[5] as MdInline.Link).href)
    }

    @Test fun streamingMatchesAWholeParseAndKeepsBlocks() {
        val answer = "# Title\n\nFirst para with `code`.\n\n```ts\nconst a = 1;\n\nconst b = 2;\n```\n\n" +
            "- one\n- two\n\n  still two\n\n$$\nx^2\n$$\n\n> quote\n> more\n\nLast *words* here.\n\nSetext\n---\n"
        val cache = MarkdownCache()
        var previous: List<MdBlock> = emptyList()
        for (end in 1..answer.length) {
            val got = cache.blocks(answer.substring(0, end))
            assertEquals("at $end", parseMarkdown(answer.substring(0, end)), got)
            // Everything but the last two blocks is the very same instance as before.
            for (i in 0 until minOf(previous.size, got.size) - 2) {
                if (previous[i] == got[i]) assertSame("block $i at $end", previous[i], got[i])
            }
            previous = got
        }
    }

    @Test fun localImagesLeaveTheSentenceWhole() {
        val inlines = (parseMarkdown("Before ![a](shot.png) after ![w](https://x.dev/i.png)")[0] as MdBlock.Para).inlines
        assertEquals(
            listOf(plain("Before after "), MdInline.Image("https://x.dev/i.png", "w")),
            withoutImages(inlines),
        )
    }
}
