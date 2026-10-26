import Foundation

// shared/read-code.ts: what a read printed, taken back to the file's own lines, so it can open
// highlighted in the file's language beside the file's line numbers. Claude's Read and `nl -ba`
// number every line; `sed -n 115,135p` starts at 115.

public struct ReadCode: Sendable, Equatable {
    public var file: String
    public var code: String
    /// The file's number for the first line, when the output says it.
    public var first: Int?

    public init(file: String, code: String, first: Int? = nil) {
        self.file = file
        self.code = code
        self.first = first
    }
}

/// The file a call read and the lines it printed; none for a call that read several, or failed.
public func readCode(_ call: AgentActivity) -> ReadCode? {
    guard let detail = call.detail, !detail.isEmpty, call.status != "failed" else { return nil }
    guard let actions = call.actions, actions.count == 1, case .read(let file, let range) = actions[0] else { return nil }
    let lines = withoutLastNewline(detail).components(separatedBy: "\n")
    let numbered = numberedRun(lines)
    // Claude's Read always numbers its lines; a command's output only counts as numbered when most of it is.
    let isNumbered = !numbered.isEmpty && (call.kind == "read" || numbered.count * 2 >= lines.count)
    if isNumbered {
        return ReadCode(file: file, code: numbered.map(\.text).joined(separator: "\n"), first: numbered[0].n)
    }
    return ReadCode(file: file, code: lines.joined(separator: "\n"), first: rangeStart(lines, range))
}

/// By scalar, as the desktop's `/\n$/` does: a Character would hold "\r\n" as one.
private func withoutLastNewline(_ text: String) -> String {
    var scalars = text.unicodeScalars
    if scalars.last == "\n" { scalars.removeLast() }
    return String(scalars)
}

/// A line `cat -n` style: its number, a tab (an arrow in older Claude Code), then the line.
nonisolated(unsafe) private let numberedLine = #/^\s*(\d+)(?:\t|→)(.*)$/#.asciiOnlyDigits()

/// The longest run of numbered lines counting up from the top. Output kept from its end may start
/// mid-line, so the run can start on the second line; it stops where something was appended after
/// the file, like a reminder.
private func numberedRun(_ lines: [String]) -> [(n: Int, text: String)] {
    func runFrom(_ start: Int) -> [(n: Int, text: String)] {
        var run: [(n: Int, text: String)] = []
        for line in lines.dropFirst(start) {
            guard let found = line.wholeMatch(of: numberedLine), let n = Int(found.1) else { break }
            if let last = run.last, n != last.n + 1 { break }
            run.append((n, String(found.2)))
        }
        return run
    }
    let fromTop = runFrom(0)
    let fromSecond = runFrom(1)
    return fromSecond.count > fromTop.count ? fromSecond : fromTop
}

/// Where `sed -n 115,135p` started, when it printed every line it asked for; output cut short has fewer.
private func rangeStart(_ lines: [String], _ range: String?) -> Int? {
    let ends = (range ?? "").components(separatedBy: "–").map { Int($0) ?? 0 }
    guard ends.count > 1, ends[0] != 0, ends[1] != 0 else { return nil }
    return lines.count == ends[1] - ends[0] + 1 ? ends[0] : nil
}
