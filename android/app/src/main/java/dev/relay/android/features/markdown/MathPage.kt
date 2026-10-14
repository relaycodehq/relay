package dev.relay.android.features.markdown

import android.content.res.AssetManager
import dev.relay.android.features.renders.RenderTheme
import dev.relay.android.features.renders.phoneRenderDocument
import kotlinx.serialization.json.JsonPrimitive

// A port of mobile/src/ui/math/math-page.ts. The KaTeX files ship in
// assets/katex/, one CSS file per font face with the font inlined, so a page
// carries only the faces its formula uses.

/** KaTeX's stylesheet, script and font faces (`@font-face` CSS by face name). */
class KatexAssets(val css: String, val js: String, val fonts: Map<String, String>)

private val FACES = listOf(
    "AMS-Regular", "Caligraphic-Bold", "Caligraphic-Regular", "Fraktur-Bold", "Fraktur-Regular",
    "Main-Bold", "Main-BoldItalic", "Main-Italic", "Main-Regular", "Math-BoldItalic", "Math-Italic",
    "SansSerif-Bold", "SansSerif-Italic", "SansSerif-Regular", "Script-Regular",
    "Size1-Regular", "Size2-Regular", "Size3-Regular", "Size4-Regular", "Typewriter-Regular",
)

@Volatile private var loaded: KatexAssets? = null

/** Read once from the APK; about 600 KB, so call it off the main thread. */
fun katexAssets(assets: AssetManager): KatexAssets = loaded ?: synchronized(FACES) {
    loaded ?: run {
        fun read(path: String) = assets.open("katex/$path").bufferedReader().use { it.readText() }
        KatexAssets(
            css = read("katex.min.css"),
            js = read("katex.min.js"),
            fonts = FACES.associateWith { read("fonts/$it.css") },
        )
    }.also { loaded = it }
}

/** What every formula may draw with: text, variables, big operators and delimiters, AMS symbols. */
private val ALWAYS = listOf(
    "Main-Regular", "Main-Italic", "Math-Italic", "AMS-Regular",
    "Size1-Regular", "Size2-Regular", "Size3-Regular", "Size4-Regular",
)

/** The faces a command in the formula asks for beyond those. */
private val ASKED: List<Pair<Regex, List<String>>> = listOf(
    Regex("""\\(?:mathbf|boldsymbol|bm|bf|textbf|pmb|bold)(?![A-Za-z])""") to
        listOf("Main-Bold", "Main-BoldItalic", "Math-BoldItalic"),
    Regex("""\\(?:mathcal|cal)(?![A-Za-z])""") to listOf("Caligraphic-Regular", "Caligraphic-Bold"),
    Regex("""\\(?:mathfrak|frak)(?![A-Za-z])""") to listOf("Fraktur-Regular", "Fraktur-Bold"),
    Regex("""\\mathscr(?![A-Za-z])""") to listOf("Script-Regular"),
    Regex("""\\(?:mathsf|textsf|sf|mathsfit)(?![A-Za-z])""") to
        listOf("SansSerif-Regular", "SansSerif-Bold", "SansSerif-Italic"),
    Regex("""\\(?:mathtt|texttt|tt)(?![A-Za-z])""") to listOf("Typewriter-Regular"),
)

/** The font faces `tex` draws with, rather than all of KaTeX's ~340 KB of them. */
fun fontsFor(tex: String, katex: KatexAssets): String {
    val names = LinkedHashSet(ALWAYS)
    for ((command, faces) in ASKED) if (command.containsMatchIn(tex)) names += faces
    return names.joinToString("") { katex.fonts[it].orEmpty() }
}

/** A display formula as a page of its own, typeset by KaTeX inside the WebView. */
fun mathDocument(tex: String, theme: RenderTheme, katex: KatexAssets): String {
    // The formula is text from an agent, set inside a script: no way out of it.
    val source = JsonPrimitive(tex).toString().replace("<", "\\u003c")
    return phoneRenderDocument(
        "<!doctype html><html><head><meta charset=\"utf-8\"><style>${fontsFor(tex, katex)}${katex.css}\n" +
            "body{padding:2px 0}.katex-display{margin:0;overflow-x:auto;overflow-y:hidden}.katex{font-size:1.1em}</style>" +
            "<script>${katex.js}</script></head><body><div id=\"math\"></div><script>katex.render($source," +
            "document.getElementById(\"math\"),{displayMode:true,throwOnError:false,strict:\"ignore\",trust:false," +
            "output:\"htmlAndMathml\",maxSize:30,maxExpand:500,errorColor:\"var(--danger)\"})</script></body></html>",
        theme,
    )
}
