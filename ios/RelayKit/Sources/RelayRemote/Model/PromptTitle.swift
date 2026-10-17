import Foundation

private let pasteBlock = try! NSRegularExpression(
    pattern: "(?:^|\\n\\n?)Pasted text #(\\d+):\\n\\n(`{3,})\\n([\\s\\S]*?)\\n\\2(?:\\n\\n|$)")
/// The `@acp:goose ` a composer puts before a message to a registry agent.
private let registryMention = try! NSRegularExpression(pattern: "^@acp:[a-z0-9][a-z0-9-]*(?=\\s|$)\\s*")

/// shared/prompt-title.ts: what a thread is called from its first message until a generated
/// title comes, as the desktop names it and a phone opening one it just started.
public func promptTitle(_ body: String) -> String {
    let whole = NSRange(body.startIndex..., in: body)
    let pastes = pasteBlock.matches(in: body, range: whole).compactMap { Range($0.range(at: 3), in: body).map { String(body[$0]) } }
    var text = pasteBlock.stringByReplacingMatches(in: body, range: whole, withTemplate: "\n\n")
    text = withoutAgentMention(text)
    text = registryMention.stringByReplacingMatches(in: text, range: NSRange(text.startIndex..., in: text), withTemplate: "")
    // A message that is only a paste is named after the paste's first line;
    // one that is only screenshots waits for a generated title as "Screenshot".
    var title = text.trimmingCharacters(in: .whitespacesAndNewlines)
    if title.isEmpty, let paste = pastes.first {
        title = String(paste.drop { $0.isWhitespace }.prefix { $0 != "\n" }).trimmingCharacters(in: .whitespaces)
    }
    // Characters, not UTF-16 units: an emoji is never cut in half.
    let cut = String(title.prefix(65))
    return cut.isEmpty ? "Screenshot" : cut
}
