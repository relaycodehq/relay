import Foundation
import Markdown

/// An answer's markdown as blocks to draw, as Android's MarkdownModel: text
/// runs carry Foundation's inline intents (bold, code, links…), which
/// SwiftUI's Text draws, and formulas inside a sentence `inlineMath`.
public indirect enum MdBlock: Hashable, Sendable {
    case paragraph(AttributedString)
    /// A paragraph with pictures that aren't on the web: its `text` without them, the
    /// pictures under it. `whole` is the paragraph as it reads where they can't be drawn.
    case figure(text: AttributedString, whole: AttributedString, images: [MdImage])
    case heading(level: Int, AttributedString)
    /// `language` is the first word of the fence's info string.
    case code(language: String?, text: String)
    /// A display formula's TeX, for KaTeX (`mathDocument`). `closed` is false while its
    /// closing `$$` hasn't arrived; until then, and where it can't be typeset, Android
    /// shows the TeX itself.
    case math(tex: String, closed: Bool)
    case quote([MdBlock])
    case list(ordered: Bool, start: Int, items: [MdItem])
    case table(header: [AttributedString], rows: [[AttributedString]])
    case rule
    /// Raw HTML, shown as written.
    case html(String)
}

public struct MdImage: Hashable, Sendable {
    public var source: String
    public var alt: String

    public init(source: String, alt: String) {
        self.source = source
        self.alt = alt
    }
}

public struct MdItem: Hashable, Sendable {
    /// A task list's box: true ticked, false empty, nil an ordinary item.
    public var checked: Bool?
    public var blocks: [MdBlock]
}

/// How a formula inside a sentence is set in its run of text.
public enum InlineMath: Hashable, Sendable {
    /// As plain text (`x²`, `α ≤ β`, see `texToPlain`); the run is also `.emphasized`, as
    /// Android sets it in a serif italic.
    case plain
    /// As its TeX, which plain text can't hold; Android sets it in muted monospace.
    case source
}

/// Marks a formula's run in a block's text; read it as `run.inlineMath`.
public enum InlineMathAttribute: AttributedStringKey {
    public typealias Value = InlineMath
    public static let name = "RelayInlineMath"
}

extension AttributeScopes {
    /// The attributes RelayMarkdown adds to Foundation's.
    public struct RelayMarkdownAttributes: AttributeScope {
        public let inlineMath: InlineMathAttribute
        public let foundation: FoundationAttributes
    }

    public var relayMarkdown: RelayMarkdownAttributes.Type { RelayMarkdownAttributes.self }
}

extension AttributeDynamicLookup {
    public subscript<T: AttributedStringKey>(dynamicMember keyPath: KeyPath<AttributeScopes.RelayMarkdownAttributes, T>) -> T {
        self[T.self]
    }
}

/// The blocks of an answer, its math in any of the ways agents write it (`normalizeMath`).
public func markdownBlocks(_ text: String) -> [MdBlock] {
    let math = MathText(normalizeMath(text))
    return Reader(math: math).blocks(Document(parsing: math.text).children)
}

private struct Reader {
    let math: MathText

    func blocks(_ children: MarkupChildren) -> [MdBlock] {
        children.compactMap(block)
    }

    private func block(_ markup: Markup) -> MdBlock? {
        switch markup {
        case let p as Paragraph: return paragraph(p)
        case let h as Heading: return .heading(level: h.level, inline(h.children))
        case let c as CodeBlock:
            if let formula = math.display(c) { return .math(tex: formula.tex, closed: formula.closed) }
            let language = c.language?.split(whereSeparator: \.isWhitespace).first.map(String.init)
            let code = math.restoring(c.code)
            return .code(language: language, text: code.hasSuffix("\n") ? String(code.dropLast()) : code)
        case let q as BlockQuote: return .quote(blocks(q.children))
        case let l as OrderedList: return .list(ordered: true, start: Int(l.startIndex), items: items(l.listItems))
        case let l as UnorderedList: return .list(ordered: false, start: 1, items: items(l.listItems))
        case let t as Table:
            return .table(
                header: t.head.cells.map { inline($0.children) },
                rows: t.body.rows.map { row in row.cells.map { inline($0.children) } })
        case is ThematicBreak: return .rule
        case let h as HTMLBlock: return .html(math.restoring(h.rawHTML).trimmingCharacters(in: .newlines))
        default:
            let text = math.restoring(markup.format())
            return text.isEmpty ? nil : .paragraph(AttributedString(text))
        }
    }

    private func paragraph(_ p: Paragraph) -> MdBlock {
        let whole = inline(p.children)
        let drawn = { (markup: Markup) -> MdImage? in
            guard let i = markup as? Image, let source = i.source.map(math.restoring), !isWebImage(source)
            else { return nil }
            return MdImage(source: source, alt: math.restoring(i.plainText))
        }
        let images = p.children.compactMap(drawn)
        guard !images.isEmpty else { return .paragraph(whole) }
        // "Before ![](a.png) after" reads "Before after", not with the picture's two spaces.
        var text = AttributedString()
        var gap = false
        for child in p.children {
            if drawn(child) != nil {
                gap = true
                continue
            }
            var run = inline(child, [], link: nil)
            if gap, text.characters.last?.isWhitespace == true {
                run = AttributedString(run[(run.characters.firstIndex { !$0.isWhitespace } ?? run.endIndex)...])
            }
            text += run
            gap = false
        }
        return .figure(text: text, whole: whole, images: images)
    }

    private func items(_ list: some Sequence<ListItem>) -> [MdItem] {
        list.map { item in
            MdItem(
                checked: item.checkbox.map { $0 == .checked },
                blocks: blocks(item.children))
        }
    }

    private func inline(_ children: MarkupChildren, _ intent: InlinePresentationIntent = [], link: URL? = nil)
        -> AttributedString
    {
        children.reduce(into: AttributedString()) { out, child in out += inline(child, intent, link: link) }
    }

    private func inline(_ markup: Markup, _ intent: InlinePresentationIntent, link: URL?) -> AttributedString {
        func text(_ string: String, _ extra: InlinePresentationIntent = []) -> AttributedString {
            var run = AttributedString(string)
            let all = intent.union(extra)
            if !all.isEmpty { run.inlinePresentationIntent = all }
            if let link { run.link = link }
            return run
        }
        // A formula inside a sentence as plain text; one that can't be stays as its source.
        func formula(_ source: String) -> AttributedString {
            let tex = source.trimmingCharacters(in: .whitespacesAndNewlines)
            guard let plain = texToPlain(tex) else {
                var run = text(tex)
                run.inlineMath = .source
                return run
            }
            var run = text(plain, .emphasized)
            run.inlineMath = .plain
            return run
        }
        switch markup {
        case let t as Text:
            // A `$$` line the parser didn't take for a fence is text again.
            if t.string == mathFence { return text("$$") }
            return math.pieces(t.string).reduce(into: AttributedString()) { out, piece in
                switch piece {
                case .text(let string) where link == nil:
                    for (part, url) in autolinked(string) {
                        var run = text(part)
                        if let url { run.link = url }
                        out += run
                    }
                case .text(let string): out += text(string)
                case .formula(let source): out += formula(source)
                }
            }
        case let e as Emphasis: return inline(e.children, intent.union(.emphasized), link: link)
        case let s as Strong: return inline(s.children, intent.union(.stronglyEmphasized), link: link)
        case let s as Strikethrough: return inline(s.children, intent.union(.strikethrough), link: link)
        case let c as InlineCode: return text(math.restoring(c.code), .code)
        case let l as Link:
            let destination = l.destination.map(math.restoring)
            let url = destination.flatMap(URL.init(string:))
            let label = inline(l.children, intent, link: url ?? link)
            return label.characters.isEmpty ? text(destination ?? "") : label
        case let i as Image:
            // A web image stays a link: loading it would tell its server the thread was read.
            // Others are drawn under their paragraph; here only inside a link or emphasis.
            let source = i.source.map(math.restoring)
            let alt = math.restoring(i.plainText)
            var run = text(alt.isEmpty ? (source ?? "image") : alt)
            if let url = source.flatMap(URL.init(string:)) { run.link = url }
            return run
        case is SoftBreak: return text(" ")
        case is LineBreak: return text("\n")
        case let h as InlineHTML: return text(math.restoring(h.rawHTML))
        default: return text(math.restoring(markup.format()))
        }
    }
}

private func isWebImage(_ source: String) -> Bool {
    source.range(of: "^https?://", options: [.regularExpression, .caseInsensitive]) != nil
}
