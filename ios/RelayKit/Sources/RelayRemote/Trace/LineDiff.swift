import Foundation

// What an edit swapped, line by line, as the desktop's `diffArrays` reads it: the lines both
// sides keep are context, and only what changed is marked.

public enum LineMark: Sendable, Equatable {
    case same, removed, added
}

public struct DiffLine: Sendable, Equatable {
    public var mark: LineMark
    public var text: String

    public init(_ mark: LineMark, _ text: String) {
        self.mark = mark
        self.text = text
    }
}

/// The most cells the common-run table may have; past it the middle reads as replaced whole.
public let maxDiffCells = 2_000_000

/// `old` turned into `new` through their longest common run of lines; within a change the
/// removed lines come before the added ones.
public func lineDiff(_ old: String, _ new: String) -> [DiffLine] {
    let before = linesOf(old)
    let after = linesOf(new)
    // The lines both start and end with need no table.
    var head = 0
    while head < before.count, head < after.count, before[head] == after[head] { head += 1 }
    var tail = 0
    while tail < before.count - head, tail < after.count - head,
        before[before.count - 1 - tail] == after[after.count - 1 - tail]
    {
        tail += 1
    }
    let removed = Array(before[head..<(before.count - tail)])
    let added = Array(after[head..<(after.count - tail)])
    let middle =
        removed.count * added.count > maxDiffCells
        ? removed.map { DiffLine(.removed, $0) } + added.map { DiffLine(.added, $0) }
        : commonRunDiff(removed, added)
    return before[..<head].map { DiffLine(.same, $0) } + middle + after[(after.count - tail)...].map { DiffLine(.same, $0) }
}

private func commonRunDiff(_ before: [String], _ after: [String]) -> [DiffLine] {
    // kept[i][j]: how many lines `before[i...]` and `after[j...]` have in common.
    var kept = Array(repeating: Array(repeating: 0, count: after.count + 1), count: before.count + 1)
    for i in stride(from: before.count - 1, through: 0, by: -1) {
        for j in stride(from: after.count - 1, through: 0, by: -1) {
            kept[i][j] = before[i] == after[j] ? kept[i + 1][j + 1] + 1 : max(kept[i + 1][j], kept[i][j + 1])
        }
    }
    var lines: [DiffLine] = []
    var i = 0
    var j = 0
    while i < before.count || j < after.count {
        if i < before.count, j < after.count, before[i] == after[j] {
            lines.append(DiffLine(.same, after[j]))
            i += 1
            j += 1
        } else if j == after.count || (i < before.count && kept[i + 1][j] >= kept[i][j + 1]) {
            lines.append(DiffLine(.removed, before[i]))
            i += 1
        } else {
            lines.append(DiffLine(.added, after[j]))
            j += 1
        }
    }
    return lines
}

/// A unified diff's lines from its first hunk on, marked by their first character; the file
/// headers before it go. Nil when it has no hunk, as an added file's whole content.
public func patchLines(_ diff: String) -> [DiffLine]? {
    let lines = diff.components(separatedBy: "\n")
    guard let first = lines.firstIndex(where: { $0.hasPrefix("@@") }) else { return nil }
    return lines[first...].map { line in
        if line.hasPrefix("@@") { return DiffLine(.same, line) }
        if line.hasPrefix("+") { return DiffLine(.added, String(line.dropFirst())) }
        if line.hasPrefix("-") { return DiffLine(.removed, String(line.dropFirst())) }
        return DiffLine(.same, line.hasPrefix(" ") ? String(line.dropFirst()) : line)
    }
}

/// "+17 −2": how many lines a diff added and removed.
public func changeCounts(_ lines: [DiffLine]) -> (added: Int, removed: Int) {
    (lines.count { $0.mark == .added }, lines.count { $0.mark == .removed })
}

/// A passage's lines; an empty one, like what a deletion leaves, has none.
private func linesOf(_ text: String) -> [String] {
    text.isEmpty ? [] : text.components(separatedBy: "\n")
}
