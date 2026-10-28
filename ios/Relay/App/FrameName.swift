import Foundation

/// A demangled Swift symbol the way `swift demangle --simplified` puts it, short
/// enough for the one line a crash shows:
/// `closure #2 @Sendable (A, B) -> () in Relay.Microphone.start(interrupted: () -> ()) throws -> X`
/// becomes `closure #2 in Microphone.start(interrupted:)`.
enum FrameName {
    static func simplified(_ demangled: String) -> String {
        var rest = droppingAttributes(Substring(demangled))
        var closures: [String] = []
        while let closure = rest.prefixMatch(of: #/(implicit )?closure #\d+/#),
            let inside = topLevel(" in ", in: rest, from: closure.range.upperBound)
        {
            closures.append(String(closure.output.0))
            rest = droppingAttributes(rest[inside.upperBound...])
        }
        return (closures + [function(rest)]).joined(separator: " in ")
    }

    /// `Relay.Microphone.start(interrupted: () -> ()) throws -> X` → `Microphone.start(interrupted:)`.
    private static func function(_ symbol: Substring) -> String {
        // A private function's file discriminator: `(crashed in _A116…)` is `crashed`.
        let named = String(symbol).replacing(#/\((\w+) in _[0-9A-F]+\)/#) { String($0.output.1) }
        guard let open = named.firstIndex(of: "("), let close = closing(named, from: open) else {
            let name = named.components(separatedBy: " : ").first ?? named
            return withoutModules(name.components(separatedBy: " -> ").first ?? name)
        }
        let arguments = splitTopLevel(named[named.index(after: open)..<close])
        let labels = arguments.map { argument in
            topLevel(":", in: argument, from: argument.startIndex)
                .map { argument[..<$0.lowerBound].trimmingCharacters(in: .whitespaces) + ":" } ?? "_:"
        }
        return withoutModules(String(named[..<open])) + "(" + labels.joined() + ")"
    }

    private static func droppingAttributes(_ symbol: Substring) -> Substring {
        var rest = symbol
        while let attribute = ["@objc ", "@Sendable ", "static "].first(where: rest.hasPrefix) {
            rest = rest.dropFirst(attribute.count)
        }
        return rest
    }

    private static func withoutModules(_ name: String) -> String {
        name.replacingOccurrences(of: "Relay.", with: "").replacingOccurrences(of: "Swift.", with: "")
    }

    /// Where `needle` first sits outside every bracket; `->` opens and closes nothing.
    private static func topLevel(_ needle: String, in text: Substring, from start: Substring.Index)
        -> Range<Substring.Index>?
    {
        var depth = 0
        var at = start
        while at < text.endIndex {
            if depth == 0, text[at...].hasPrefix(needle) { return at..<text.index(at, offsetBy: needle.count) }
            if text[at...].hasPrefix("->") {
                at = text.index(at, offsetBy: 2)
                continue
            }
            switch text[at] {
            case "(", "[", "<": depth += 1
            case ")", "]", ">": depth -= 1
            default: break
            }
            at = text.index(after: at)
        }
        return nil
    }

    private static func closing(_ text: String, from open: String.Index) -> String.Index? {
        let after = text[text.index(after: open)...]
        guard let end = topLevel(")", in: after, from: after.startIndex) else { return nil }
        return end.lowerBound
    }

    private static func splitTopLevel(_ arguments: Substring) -> [Substring] {
        var parts: [Substring] = []
        var rest = arguments
        while let comma = topLevel(",", in: rest, from: rest.startIndex) {
            parts.append(rest[..<comma.lowerBound])
            rest = rest[comma.upperBound...]
        }
        if !rest.trimmingCharacters(in: .whitespaces).isEmpty { parts.append(rest) }
        return parts
    }
}
