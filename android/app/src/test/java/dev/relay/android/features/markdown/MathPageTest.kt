package dev.relay.android.features.markdown

import dev.relay.android.features.renders.RenderTheme
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class MathPageTest {
    // The real files the APK ships, read from the source tree.
    private val katex = run {
        val dir = File("src/main/assets/katex")
        KatexAssets(
            css = File(dir, "katex.min.css").readText(),
            js = File(dir, "katex.min.js").readText(),
            fonts = File(dir, "fonts").listFiles()!!.associate { it.nameWithoutExtension to it.readText() },
        )
    }
    private val light = RenderTheme(false, mapOf("--text" to "#000000"))

    private fun faces(tex: String) =
        Regex("font-family:([^;]+)").findAll(fontsFor(tex, katex)).map { it.groupValues[1].trim('"', '\'', ' ') }.toList()

    @Test fun pageHasTheFormulaAsDataUnderThePageRules() {
        val page = mathDocument("x^2", light, katex)
        assertTrue(page.contains("katex.render(\"x^2\""))
        assertTrue(page.indexOf("Content-Security-Policy") in 0 until page.indexOf("katex.render"))
    }

    @Test fun aFormulaCantBreakOut() {
        val page = mathDocument("\"); alert(1) </script><b>", light, katex)
        assertFalse(page.contains("</script><b>"))
        assertTrue(page.contains("\\u003c/script>"))
        assertEquals(3, Regex("<script>").findAll(page).count())
    }

    @Test fun leavesOutAlphabetsNotAskedFor() {
        val plain = faces("\\sum_{i=1}^n \\frac{a_i}{\\sqrt{b}} \\in \\mathbb{R}")
        assertTrue(plain.contains("KaTeX_Main"))
        assertTrue(plain.contains("KaTeX_AMS"))
        assertFalse(plain.contains("KaTeX_Caligraphic"))
        assertTrue(fontsFor("x", katex).length < 200_000)
        assertTrue(faces("\\mathcal{L}").contains("KaTeX_Caligraphic"))
        assertTrue(faces("\\mathtt{x}").contains("KaTeX_Typewriter"))
    }
}
