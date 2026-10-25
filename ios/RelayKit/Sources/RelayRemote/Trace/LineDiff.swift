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

/// `old` turned into `new` through their longest common run of lines; within a change the
/// removed lines come before the added ones.
public func lineDiff(_ old: String, _ new: String) -> [DiffLine] {
    let before = old.components(separatedBy: "\n")
    let after = new.components(separatedBy: "\n")
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

/// A unified diff's lines, marked by their first character; its file and hunk headers are context.
public func patchLines(_ diff: String) -> [DiffLine] {
    diff.components(separatedBy: "\n").map { line in
        if line.hasPrefix("+") && !line.hasPrefix("+++") { return DiffLine(.added, String(line.dropFirst())) }
        if line.hasPrefix("-") && !line.hasPrefix("---") { return DiffLine(.removed, String(line.dropFirst())) }
        return DiffLine(.same, line.hasPrefix(" ") ? String(line.dropFirst()) : line)
    }
}

/// "+17 −2": how many lines a diff added and removed.
public func changeCounts(_ lines: [DiffLine]) -> (added: Int, removed: Int) {
    (lines.count { $0.mark == .added }, lines.count { $0.mark == .removed })
}
