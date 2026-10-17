import Foundation
import RelayRemote

// Android's MathPage.kt, a port of mobile/src/ui/math/math-page.ts. KaTeX
// ships as a folder (the Android app's assets/katex/): katex.min.css,
// katex.min.js and fonts/<face>.css, one CSS file per font face with the font
// inlined, so a page carries only the faces its formula uses.

/// KaTeX's stylesheet, script and font faces (`@font-face` CSS by face name).
public struct KatexAssets: Sendable {
    public var css: String
    public var js: String
    public var fonts: [String: String]

    public init(css: String, js: String, fonts: [String: String]) {
        self.css = css
        self.js = js
        self.fonts = fonts
    }

    /// Reads the files from the KaTeX folder at `directory`. About 600KB, so read
    /// it once, off the main thread, and keep it.
    public init(directory: URL) throws {
        func read(_ path: String) throws -> String {
            try String(contentsOf: directory.appending(path: path), encoding: .utf8)
        }
        try self.init(
            css: read("katex.min.css"),
            js: read("katex.min.js"),
            fonts: Dictionary(uniqueKeysWithValues: katexFaces.map { ($0, try read("fonts/\($0).css")) }))
    }
}

/// The font faces KaTeX's folder has, each as `fonts/<face>.css`.
let katexFaces = [
    "AMS-Regular", "Caligraphic-Bold", "Caligraphic-Regular", "Fraktur-Bold", "Fraktur-Regular",
    "Main-Bold", "Main-BoldItalic", "Main-Italic", "Main-Regular", "Math-BoldItalic", "Math-Italic",
    "SansSerif-Bold", "SansSerif-Italic", "SansSerif-Regular", "Script-Regular",
    "Size1-Regular", "Size2-Regular", "Size3-Regular", "Size4-Regular", "Typewriter-Regular",
]

/// What every formula may draw with: text, variables, big operators and delimiters, AMS symbols.
private let always = [
    "Main-Regular", "Main-Italic", "Math-Italic", "AMS-Regular",
    "Size1-Regular", "Size2-Regular", "Size3-Regular", "Size4-Regular",
]

/// The faces a command in the formula asks for beyond those.
private let asked: [(NSRegularExpression, [String])] = [
    (#"\\(?:mathbf|boldsymbol|bm|bf|textbf|pmb|bold)(?![A-Za-z])"#, ["Main-Bold", "Main-BoldItalic", "Math-BoldItalic"]),
    (#"\\(?:mathcal|cal)(?![A-Za-z])"#, ["Caligraphic-Regular", "Caligraphic-Bold"]),
    (#"\\(?:mathfrak|frak)(?![A-Za-z])"#, ["Fraktur-Regular", "Fraktur-Bold"]),
    (#"\\mathscr(?![A-Za-z])"#, ["Script-Regular"]),
    (#"\\(?:mathsf|textsf|sf|mathsfit)(?![A-Za-z])"#, ["SansSerif-Regular", "SansSerif-Bold", "SansSerif-Italic"]),
    (#"\\(?:mathtt|texttt|tt)(?![A-Za-z])"#, ["Typewriter-Regular"]),
].map { (try! NSRegularExpression(pattern: $0.0), $0.1) }

/// The font faces `tex` draws with, rather than all of KaTeX's ~340KB of them.
public func fontsFor(_ tex: String, katex: KatexAssets) -> String {
    var names = always
    for (command, faces) in asked
    where command.firstMatch(in: tex, range: NSRange(tex.startIndex..., in: tex)) != nil {
        names += faces.filter { !names.contains($0) }
    }
    return names.map { katex.fonts[$0] ?? "" }.joined()
}

/// A display formula as a page of its own, typeset by KaTeX inside a web view
/// (`phoneRenderDocument`'s, so it reports its height as a render does).
/// `theme` gives the page its colours: `--text` for the formula, `--danger`
/// for one KaTeX can't typeset.
public func mathDocument(_ tex: String, theme: RenderTheme, katex: KatexAssets) -> String {
    // The formula is text from an agent, set inside a script: no way out of it.
    let source = JSON.string(tex).text().replacingOccurrences(of: "<", with: "\\u003c")
    return phoneRenderDocument(
        "<!doctype html><html><head><meta charset=\"utf-8\"><style>\(fontsFor(tex, katex: katex))\(katex.css)\n"
            + "body{padding:2px 0}.katex-display{margin:0;overflow-x:auto;overflow-y:hidden}.katex{font-size:1.1em}</style>"
            + "<script>\(katex.js)</script></head><body><div id=\"math\"></div><script>katex.render(\(source),"
            + "document.getElementById(\"math\"),{displayMode:true,throwOnError:false,strict:\"ignore\",trust:false,"
            + "output:\"htmlAndMathml\",maxSize:30,maxExpand:500,errorColor:\"var(--danger)\"})</script></body></html>",
        theme: theme)
}
