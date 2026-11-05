import Foundation

// src/lib/terminal-text.ts. Colours and cursor moves (CSI), window titles and links (OSC, ended
// by BEL or ESC \), and two-byte escapes like ESC 7 or ESC ( B.
private let terminalCodes = try! NSRegularExpression(
    pattern: #"\x{1b}(?:\[[0-?]*[ -/]*[@-~]|\][^\x{07}\x{1b}]*(?:\x{07}|\x{1b}\\)?|[ -/]*[0-~])"#)

/// What a command printed, as plain text: no terminal codes, and a line it redrew with \r, like
/// a progress bar, keeps only its last state.
public func terminalText(_ output: String) -> String {
    // Scalars, not Characters: "\r\n" is one Character and would hide its \r.
    guard output.unicodeScalars.contains(where: { $0 == "\u{1b}" || $0 == "\r" }) else { return output }
    let all = NSRange(output.startIndex..., in: output)
    let plain = terminalCodes.stringByReplacingMatches(in: output, range: all, withTemplate: "")
    return plain.components(separatedBy: "\n")
        .map { line in line.components(separatedBy: "\r").last(where: { !$0.isEmpty }) ?? "" }
        .joined(separator: "\n")
}
