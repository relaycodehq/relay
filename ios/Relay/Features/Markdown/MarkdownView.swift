import RelayMarkdown
import SwiftUI

/// An answer's markdown, block by block, its text selecting in place. `small` is for
/// commentary between tool calls.
struct MarkdownView: View {
    let blocks: [MdBlock]
    var small = false
    /// Set back, as a quote is.
    var secondary = false

    init(_ text: String, small: Bool = false) {
        blocks = ParsedMarkdown.blocks(text)
        self.small = small
        secondary = small
    }

    init(blocks: [MdBlock], small: Bool, secondary: Bool) {
        self.blocks = blocks
        self.small = small
        self.secondary = secondary
    }

    var body: some View {
        VStack(alignment: .leading, spacing: small ? 6 : 12) {
            ForEach(Array(blocks.enumerated()), id: \.offset) { _, block in
                BlockView(block: block, small: small, secondary: secondary)
            }
        }
        .font(small ? .subheadline : .body)
        .foregroundStyle(secondary ? .secondary : .primary)
    }
}

/// Answers parsed once rather than each time their message is drawn: a thread's messages are
/// made again on every change to it, and parsing them was a good part of opening one.
private enum ParsedMarkdown {
    private static var parsed: [String: [MdBlock]] = [:]

    static func blocks(_ text: String) -> [MdBlock] {
        if let known = parsed[text] { return known }
        let blocks = markdownBlocks(text)
        // Streamed answers leave a copy per update behind; a thread's worth is plenty to keep.
        if parsed.count > 400 { parsed.removeAll(keepingCapacity: true) }
        parsed[text] = blocks
        return blocks
    }
}

extension EnvironmentValues {
    /// Draws an answer's `![alt](src)` that isn't on the web; without it the picture stays in the text.
    @Entry var markdownImage: ((MdImage) -> AnyView)?
}

private struct BlockView: View {
    let block: MdBlock
    let small: Bool
    let secondary: Bool
    @Environment(\.markdownImage) private var markdownImage

    private var look: TextLook { TextLook(style: small ? .subheadline : .body, secondary: secondary) }

    var body: some View {
        switch block {
        case .paragraph(let text):
            SelectableText(text: text, look: look)
        case .figure(let text, let whole, let images):
            // The text stays whole and its pictures follow: one that doesn't load leaves the sentence as it reads.
            if let markdownImage {
                VStack(alignment: .leading, spacing: 10) {
                    if !text.characters.allSatisfy(\.isWhitespace) { SelectableText(text: text, look: look) }
                    ForEach(images, id: \.self) { markdownImage($0) }
                }
            } else {
                SelectableText(text: whole, look: look)
            }
        case .heading(let level, let text):
            SelectableText(
                text: text,
                look: TextLook(
                    style: level == 1 ? .title3 : level == 2 ? .headline : .subheadline,
                    weight: level == 2 ? nil : .semibold, secondary: secondary)
            )
            .padding(.top, 4)
        case .code(let language, let text):
            CodeBlock(language: language, code: text)
        case .math(let tex, let closed):
            MathBlock(tex: tex, closed: closed)
        case .quote(let inner):
            HStack(spacing: 10) {
                RoundedRectangle(cornerRadius: 1.5).fill(.rule).frame(width: 3)
                MarkdownView(blocks: inner, small: small, secondary: true)
            }
            .fixedSize(horizontal: false, vertical: true)
        case .list(let ordered, let start, let items):
            VStack(alignment: .leading, spacing: 6) {
                ForEach(Array(items.enumerated()), id: \.offset) { i, item in
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        marker(ordered: ordered, number: start + i, checked: item.checked)
                        MarkdownView(blocks: item.blocks, small: small, secondary: secondary)
                    }
                }
            }
        case .table(let header, let rows):
            TableBlock(header: header, rows: rows)
        case .rule:
            Divider()
        case .html(let raw):
            Text(raw).font(.mono(.footnote)).foregroundStyle(.secondary)
        }
    }

    @ViewBuilder private func marker(ordered: Bool, number: Int, checked: Bool?) -> some View {
        if let checked {
            Image(systemName: checked ? "checkmark.square.fill" : "square")
                .foregroundStyle(checked ? AnyShapeStyle(.tint) : AnyShapeStyle(.secondary))
        } else if ordered {
            Text("\(number).").monospacedDigit().foregroundStyle(.secondary)
        } else {
            Text("•").foregroundStyle(.secondary)
        }
    }
}

/// A run of text that doesn't select, its inline code set apart: a table's cells, sized
/// by the grid.
struct Inline: View {
    let text: AttributedString
    @Environment(\.colors) private var colors

    var body: some View {
        Text(styled)
            .fixedSize(horizontal: false, vertical: true)
    }

    private var styled: AttributedString {
        var out = text
        for run in out.runs {
            // On the theme's code colour, a size under the words around it, as Android sets it.
            if run.inlinePresentationIntent?.contains(.code) == true {
                out[run.range].backgroundColor = colors.code
                out[run.range].font = .mono(.subheadline)
            }
            // A formula: in a serif italic as plain text, else its TeX in a muted monospace.
            switch run.inlineMath {
            case .plain: out[run.range].font = .system(.body, design: .serif).italic()
            case .source:
                out[run.range].font = .mono(.body)
                out[run.range].foregroundColor = Color.secondary
            case nil: break
            }
        }
        return out
    }
}

private struct TableBlock: View {
    let header: [AttributedString]
    let rows: [[AttributedString]]

    var body: some View {
        ScrollView(.horizontal) {
            Grid(alignment: .leading, horizontalSpacing: 16, verticalSpacing: 8) {
                GridRow {
                    ForEach(Array(header.enumerated()), id: \.offset) { _, cell in
                        Inline(text: cell).fontWeight(.semibold).frame(minWidth: 60, maxWidth: 220, alignment: .leading)
                    }
                }
                Divider()
                ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                    GridRow {
                        ForEach(Array(row.enumerated()), id: \.offset) { _, cell in
                            Inline(text: cell).frame(minWidth: 60, maxWidth: 220, alignment: .leading)
                        }
                    }
                }
            }
            .font(.subheadline)
            .padding(.vertical, 2)
        }
        .scrollIndicators(.hidden)
    }
}
