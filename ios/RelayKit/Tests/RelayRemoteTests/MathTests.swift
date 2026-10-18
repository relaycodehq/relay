import Foundation
import RelayMarkdown
import RelayRemote
import Testing

// Android's MathDelimitersTest: the cases of shared/math-delimiters.test.ts.
struct MathDelimitersTests {
    @Test func rewritesEachWayOfWritingMath() {
        let cases = [
            ("so \\(x^2\\) holds", "so $$x^2$$ holds"),
            ("so \\[a_1 + b\\] holds", "so $$a_1 + b$$ holds"),
            ("so \\[\\sigma\\] holds", "so $$\\sigma$$ holds"),
            ("so $x_1$ and $\\alpha$.", "so $$x_1$$ and $$\\alpha$$."),
            ("It costs $5 and $10, and $x_1$ is free.", "It costs $5 and $10, and $$x_1$$ is free."),
            ("$$ E = mc^2 $$", "$$\nE = mc^2\n$$"),
            ("\\[ E = mc^2 \\]", "$$\nE = mc^2\n$$"),
            ("\\[\n a &= b \\\\\n c &= d\n\\]", "$$\n a &= b \\\\\n c &= d\n$$"),
            ("$$ \\begin{aligned}\na &= b\n\\end{aligned} $$", "$$\n\\begin{aligned}\na &= b\n\\end{aligned}\n$$"),
            ("> \\[\n> x^2\n> \\]", "> $$\n> x^2\n> $$"),
        ]
        for (input, expected) in cases { #expect(normalizeMath(input) == expected, "\(input)") }
    }

    @Test func leavesProseAlone() {
        let prose = [
            "It costs $5 and then $10.",
            "Between $5-$10 or $3 to $5.",
            "Set $HOME/$USER and $PATH:$HOME.",
            "The script sets cost=$cost, total=$total first.",
            "Routes match /^\\d+$/ and /^\\w+$/ for ids.",
            "Read $a+$b and $x^$y, then $f($g).",
            "A \\$5 fee and \\$x\\$.",
            "Tag \\[WIP\\] and \\[draft\\].",
            "Match \\[\\d+\\] or \\[\\w{2,4}\\.\\s\\] in the log.",
            "Already $$x$$ inline stays.",
            "`$x$` and ``\\(x\\)`` are code",
            "```\n$x$\n\\[\n$$\n```",
        ]
        for text in prose { #expect(normalizeMath(text) == text) }
    }

    @Test func escapesProseStartingWithDollars() {
        #expect(normalizeMath("$$ is the PID of the shell") == "\\$$ is the PID of the shell")
    }

    @Test func keepsAFormulaStillStreamingIn() {
        #expect(normalizeMath("Intro\n\n$$\n\\frac{a}{") == "Intro\n\n$$\n\\frac{a}{")
        #expect(normalizeMath("\\[\nx = \\frac{") == "$$\nx = \\frac{")
    }

    @Test func anUnclosedBracketDoesNotSwallowWhatFollows() {
        let text = "\\[WIP] first\n\nthen prose\n\nand more"
        #expect(normalizeMath(text) == text)
    }

    @Test func isIdempotent() {
        for text in ["a \\(x\\) b $y_2$ c\n\n\\[\nz\n\\]\n\n$$\nw\n$$", "> $$ x $$\n\n- \\[ a^2 \\]", "$$\nunfinished"] {
            #expect(normalizeMath(normalizeMath(text)) == normalizeMath(text))
        }
    }
}

// Android's TexPlainTest: the cases of shared/tex-plain.test.ts.
struct TexPlainTests {
    @Test func translates() {
        let cases = [
            ("x", "x"),
            ("x^2 + y_1", "x² + y₁"),
            ("\\alpha = 0.1", "α = 0.1"),
            ("\\theta_{t+1} = \\theta_t - \\alpha \\nabla L", "θₜ₊₁ = θₜ - α ∇ L"),
            ("\\frac{a}{b}", "a/b"),
            ("\\frac{a+1}{b}", "(a+1)/b"),
            ("\\sqrt{x}", "√x"),
            ("\\sqrt{x+1}", "√(x+1)"),
            ("\\mathbb{R}^n", "ℝⁿ"),
            ("\\ell_i + \\hbar", "ℓᵢ + ℏ"),
            ("\\sum_{i=1}^n x_i", "∑ᵢ₌₁ⁿ xᵢ"),
            ("a \\leq b \\to c", "a ≤ b → c"),
            ("\\text{if } x \\in S", "if x ∈ S"),
            ("O(n \\log n)", "O(n log n)"),
            ("\\hat{x}", "x̂"),
            ("e^{i\\pi}", "e^(iπ)"),
            ("x^{a+b}", "x^(a+b)"),
        ]
        for (tex, expected) in cases { #expect(texToPlain(tex) == expected, "\(tex)") }
    }

    @Test func takesCubeAndFourthRoots() {
        #expect(texToPlain("\\sqrt[3]{x}") == "∛x")
        #expect(texToPlain("\\sqrt [4] {x+1}") == "∜(x+1)")
    }

    @Test func givesUpOnWhatItDoesntCover() {
        let unsupported = [
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
        ]
        for tex in unsupported { #expect(texToPlain(tex) == nil, "\(tex)") }
    }
}

// Android's MathPageTest.
struct MathPageTests {
    let katex: KatexAssets
    let light = RenderTheme(dark: false, vars: ["--text": "#000000"])

    // The files the Android app ships, read from the source tree.
    init() throws {
        let repo = URL(filePath: #filePath).deletingLastPathComponent().appending(path: "../../../..").standardized
        katex = try KatexAssets(directory: repo.appending(path: "android/app/src/main/assets/katex"))
    }

    private func faces(_ tex: String) -> [String] {
        fontsFor(tex, katex: katex).matches(of: #/font-family:([^;]+)/#).map {
            $0.output.1.trimmingCharacters(in: CharacterSet(charactersIn: "\"' "))
        }
    }

    @Test func pageHasTheFormulaAsDataUnderThePageRules() throws {
        let page = mathDocument("x^2", theme: light, katex: katex)
        let render = try #require(page.range(of: "katex.render(\"x^2\""))
        let rules = try #require(page.range(of: "Content-Security-Policy"))
        #expect(rules.lowerBound < render.lowerBound)
    }

    @Test func aFormulaCantBreakOut() {
        let page = mathDocument("\"); alert(1) </script><b>", theme: light, katex: katex)
        #expect(!page.contains("</script><b>"))
        #expect(page.contains("\\u003c/script>"))
        #expect(page.components(separatedBy: "<script>").count - 1 == 3)
    }

    @Test func leavesOutAlphabetsNotAskedFor() {
        let plain = faces("\\sum_{i=1}^n \\frac{a_i}{\\sqrt{b}} \\in \\mathbb{R}")
        #expect(plain.contains("KaTeX_Main"))
        #expect(plain.contains("KaTeX_AMS"))
        #expect(!plain.contains("KaTeX_Caligraphic"))
        #expect(fontsFor("x", katex: katex).utf16.count < 200_000)
        #expect(faces("\\mathcal{L}").contains("KaTeX_Caligraphic"))
        #expect(faces("\\mathtt{x}").contains("KaTeX_Typewriter"))
    }
}

// Android's MarkdownModelTest, its math cases. Inline formulas are already text
// here, where Android's model keeps their TeX until it draws them. The rest is
// how math is set aside from swift-markdown, which Android's parser needn't.
struct MathBlocksTests {
    private func text(_ text: String) -> AttributedString { AttributedString(text) }

    private func formula(_ text: String, _ kind: InlineMath) -> AttributedString {
        var run = AttributedString(text)
        if kind == .plain { run.inlinePresentationIntent = .emphasized }
        run.inlineMath = kind
        return run
    }

    private func code(_ text: String) -> AttributedString {
        var run = AttributedString(text)
        run.inlinePresentationIntent = .code
        return run
    }

    @Test func displayMathClosesOrStreams() {
        #expect(markdownBlocks("$$\na^2\n+ b\n$$") == [.math(tex: "a^2\n+ b", closed: true)])
        #expect(markdownBlocks("Intro\n\n$$\n\\frac{a}{") == [.paragraph("Intro"), .math(tex: "\\frac{a}{", closed: false)])
        #expect(markdownBlocks("> \\[\n> x^2\n> \\]") == [.quote([.math(tex: "x^2", closed: true)])])
    }

    @Test func inlineMathIsPlainTextOrItsSource() {
        #expect(markdownBlocks("so \\(x^2\\) holds") == [.paragraph(text("so ") + formula("x²", .plain) + text(" holds"))])
        #expect(markdownBlocks("It costs $5 and $10.") == [.paragraph("It costs $5 and $10.")])
        #expect(markdownBlocks("`$x$`") == [.paragraph(code("$x$"))])
        #expect(
            markdownBlocks("so $\\begin{pmatrix} a & b \\end{pmatrix}$ then")
                == [.paragraph(text("so ") + formula("\\begin{pmatrix} a & b \\end{pmatrix}", .source) + text(" then"))])
        #expect(markdownBlocks("$$ is the PID") == [.paragraph("$$ is the PID")])
        #expect(markdownBlocks("so $$x^") == [.paragraph("so $$x^")])
    }

    @Test func displayMathStartsWhereverABlockCan() {
        #expect(markdownBlocks("foo\n$$\nx\n$$") == [.paragraph("foo"), .math(tex: "x", closed: true)])
        guard case .list(false, _, let items) = markdownBlocks("- $$\n  x\n  $$").first else { Issue.record("no list"); return }
        #expect(items.map(\.blocks) == [[.math(tex: "x", closed: true)]])
        // Indented past a fence, the line goes on the paragraph, as text.
        #expect(markdownBlocks("foo\n    $$\nbar") == [.paragraph("foo $$ bar")])
    }

    @Test func mathInCodeAndHTMLStaysAsWritten() {
        #expect(markdownBlocks("`$$x_1$$` and $$y$$") == [.paragraph(code("$$x_1$$") + text(" and ") + formula("y", .plain))])
        #expect(markdownBlocks("```\n$$\nx $$a_1$$\n$$\n```") == [.code(language: nil, text: "$$\nx $$a_1$$\n$$")])
        #expect(markdownBlocks("Run:\n\n    $$\n    echo $$a$$ done") == [.paragraph("Run:"), .code(language: nil, text: "$$\necho $$a$$ done")])
        #expect(markdownBlocks("<div title=\"$$a$$\">\n$$\n</div>") == [.html("<div title=\"$$a$$\">\n$$\n</div>")])
    }

    @Test func oversizedPlaceholderLikeTextStaysLiteral() {
        let literal = "$\u{E000}" + String(repeating: "9", count: 200) + "\u{E001}$"
        #expect(markdownBlocks("```\n\(literal)\n```") == [.code(language: nil, text: literal)])
        #expect(markdownBlocks("`\(literal)`") == [.paragraph(code(literal))])
    }
}
