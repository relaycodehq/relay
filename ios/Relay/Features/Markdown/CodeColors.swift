import RelayMarkdown
import SwiftUI

/// prism-react-renderer's One Dark and One Light, by token kind; nil is the text's own colour.
private func color(_ kind: TokenKind, dark: Bool) -> Color? {
    let hex: UInt32? =
        switch kind {
        case .comment: dark ? 0x5C6370 : 0xA0A1A7
        case .keyword: dark ? 0xC678DD : 0xA626A4
        case .text: dark ? 0x98C379 : 0x50A14F
        case .number, .attribute: dark ? 0xD19A66 : 0x986801
        case .function: dark ? 0x61AFEF : 0x4078F2
        case .type: dark ? 0xE5C07B : 0xC18401
        case .property, .tag: dark ? 0xE06C75 : 0xE45649
        case .op: dark ? 0x56B6C2 : 0x0184BC
        case .plain, .punctuation: nil
        }
    return hex.map { Color(red: Double($0 >> 16 & 0xff) / 255, green: Double($0 >> 8 & 0xff) / 255, blue: Double($0 & 0xff) / 255) }
}

/// One line of highlighted code, coloured for the theme.
func styledLine(_ tokens: [CodeToken], dark: Bool) -> AttributedString {
    var out = AttributedString()
    for token in tokens {
        var run = AttributedString(token.text)
        if let c = color(token.kind, dark: dark) { run.foregroundColor = c }
        out += run
    }
    return out
}

/// Highlighting an answer's code again on every redraw of a streaming thread adds up; the
/// last few blocks are kept.
@MainActor
enum Highlighted {
    private static var kept: [String: [[CodeToken]]] = [:]
    private static var order: [String] = []

    static func lines(_ code: String, language: String?) -> [[CodeToken]] {
        let key = "\(language ?? "")\u{0}\(code)"
        if let known = kept[key] { return known }
        let lines = highlight(firstLines(code), language: language)
        kept[key] = lines
        order.append(key)
        if order.count > 64 { kept[order.removeFirst()] = nil }
        return lines
    }
}
