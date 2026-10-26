import Foundation

// shared/trace-tree.ts: how a finished run of tool calls reads, grouped by what the calls did
// rather than the order they came in. ts-trace-tree.json holds this port to the TypeScript.

/// One row: a thing done, by one call or a few that did the same thing.
public struct TraceRow: Sendable, Equatable, Identifiable {
    public var id: String
    public var action: CallAction
    public var calls: [AgentActivity]
    /// A file read more than once: each read's lines.
    public var lines: [String]?
    /// A script written, then run straight after.
    public var ranToo = false
}

public enum BranchKind: String, Sendable {
    case read, search, web, edit, run, check, commit, tool
}

public enum TracePiece: Sendable, Equatable, Identifiable {
    case row(TraceRow)
    /// Two rows one verb carries: "Read a.ts and b.ts".
    case pair(TraceRow, TraceRow)
    case branch(BranchKind, heading: String, rows: [TraceRow])

    public var id: String { rows[0].id }

    public var rows: [TraceRow] {
        switch self {
        case .row(let row): [row]
        case .pair(let a, let b): [a, b]
        case .branch(_, _, let rows): rows
        }
    }
}

/// Every call says what it did, as desktops from `Bridge.traceTree` send them; older ones draw as before.
public func saysWhatItDid(_ calls: [AgentActivity]) -> Bool {
    !calls.isEmpty && calls.allSatisfy { $0.actions != nil }
}

public func rowRunning(_ row: TraceRow) -> Bool {
    row.calls.contains { $0.status == "running" }
}

/// A test or check fails by its result; anything else only when its call failed.
public func rowFailed(_ row: TraceRow) -> Bool {
    switch row.action {
    case .test(_, let failed), .check(_, let failed): failed
    default: row.calls.contains { $0.status == "failed" }
    }
}

/// A run of calls between two lines of commentary, as rows, pairs and branches.
public func traceTree(_ calls: [AgentActivity]) -> [TracePiece] {
    branches(rowsOf(calls)).flatMap { kind, rows in
        kind == .run ? commandRuns(rows).flatMap { pieces(kind, $0) } : pieces(kind, rows)
    }
}

/// What a call did worth a row: a commit's own `git log` says nothing new, and a running call has
/// only started its first part.
func shownActions(_ call: AgentActivity) -> [CallAction] {
    let actions = call.actions ?? [.tool]
    if call.status == "running" { return Array(actions.prefix(1)) }
    let commits = actions.contains { $0.kind == "commit" }
    return commits ? actions.filter { $0.kind != "git" } : actions
}

/// A row per thing done; a file read twice running, or a script written then run, share one.
public func rowsOf(_ calls: [AgentActivity]) -> [TraceRow] {
    var rows: [TraceRow] = []
    for call in calls {
        for action in shownActions(call) {
            if let last = rows.indices.last, sameRead(rows[last].action, action) {
                if !rows[last].calls.contains(where: { $0.id == call.id }) { rows[last].calls.append(call) }
                if case .read(_, let lines?) = action { rows[last].lines = (rows[last].lines ?? []) + [lines] }
                continue
            }
            if let last = rows.indices.last, ranWhatItWrote(rows[last].action, action) {
                // A command that writes a script and runs it is one call, said once.
                if !rows[last].calls.contains(where: { $0.id == call.id }) { rows[last].calls.append(call) }
                rows[last].ranToo = true
                continue
            }
            var row = TraceRow(id: "\(call.id):\(rows.count)", action: action, calls: [call])
            if case .read(_, let lines?) = action { row.lines = [lines] }
            rows.append(row)
        }
    }
    return rows
}

private func sameRead(_ a: CallAction, _ b: CallAction) -> Bool {
    guard case .read(let first, _) = a, case .read(let second, _) = b else { return false }
    return first == second
}

private func ranWhatItWrote(_ wrote: CallAction, _ ran: CallAction) -> Bool {
    guard isWrite(wrote), let file = wrote.file, case .run(let what) = ran else { return false }
    return what == baseName(file)
}

private func isWrite(_ action: CallAction) -> Bool {
    action.kind == "create" || action.kind == "edit"
}

/// Which branch a row hangs on; a script written to /tmp to run is one of the commands.
public func branchOf(_ action: CallAction) -> BranchKind {
    switch action {
    case .read, .image: .read
    case .search: .search
    case .web: .web
    case .edit(let file), .create(let file): isScratch(file) ? .run : .edit
    case .test, .check: .check
    case .commit: .commit
    case .tool: .tool
    case .git, .run: .run
    }
}

/// Rows by branch, in the order each first came up; a file read or edited again joins its first row.
private func branches(_ rows: [TraceRow]) -> [(BranchKind, [TraceRow])] {
    var order: [BranchKind] = []
    var byKind: [BranchKind: [TraceRow]] = [:]
    for row in rows {
        let kind = branchOf(row.action)
        var branch = byKind[kind] ?? []
        if let at = branch.firstIndex(where: { sameFile($0, row) }) {
            let earlier = branch[at].calls
            branch[at].calls += row.calls.filter { call in !earlier.contains { $0.id == call.id } }
            if let lines = row.lines { branch[at].lines = (branch[at].lines ?? []) + lines }
        } else {
            if branch.isEmpty { order.append(kind) }
            branch.append(row)
        }
        byKind[kind] = branch
    }
    return order.map { ($0, byKind[$0]!) }
}

/// Two reads, or two edits, of one file; a script written and run stays apart.
private func sameFile(_ a: TraceRow, _ b: TraceRow) -> Bool {
    let bothReads = a.action.kind == "read" && b.action.kind == "read"
    let bothEdits = a.action.kind == "edit" && b.action.kind == "edit"
    if !(bothReads || bothEdits) || a.ranToo || b.ranToo { return false }
    return a.action.file == b.action.file
}

/// Commands split at each script written for them, so a write isn't buried in "Ran 7 commands".
private func commandRuns(_ rows: [TraceRow]) -> [[TraceRow]] {
    var runs: [[TraceRow]] = []
    for row in rows {
        if let last = runs.indices.last, !isWrite(row.action), !isWrite(runs[last][0].action) {
            runs[last].append(row)
        } else {
            runs.append([row])
        }
    }
    return runs
}

/// One row alone, two as one sentence when one verb carries both, three and up a branch.
private func pieces(_ kind: BranchKind, _ rows: [TraceRow]) -> [TracePiece] {
    switch rows.count {
    case 1: return [.row(rows[0])]
    case 2: return pairable(rows[0], rows[1]) ? [.pair(rows[0], rows[1])] : rows.map(TracePiece.row)
    default: return [.branch(kind, heading: branchHeading(kind, rows), rows: rows)]
    }
}

/// Kinds two rows of can share one line; two pictures keep their own rows, each with its thumbnail.
private let pairVerbs: Set<String> = ["read", "search", "web", "edit", "create", "run", "git"]

/// Two rows one verb can carry: same action, both settled and fine, said the same way.
private func pairable(_ a: TraceRow, _ b: TraceRow) -> Bool {
    let sameAction = a.action.kind == b.action.kind && pairVerbs.contains(a.action.kind)
    let settled = ![a, b].contains(where: rowRunning) && ![a, b].contains(where: rowFailed)
    return sameAction && settled && a.ranToo == b.ranToo
}

private func distinctFiles(_ rows: [TraceRow]) -> Int {
    Set(rows.map { $0.action.file ?? $0.id }).count
}

/// "Read 4 files", "Ran rg 3 times", "Ran 2 checks · 1 failed".
public func branchHeading(_ kind: BranchKind, _ rows: [TraceRow]) -> String {
    switch kind {
    case .read: return "Read \(plural(distinctFiles(rows), "file"))"
    case .search: return "Searched \(plural(rows.count, "time"))"
    case .web: return "Searched the web \(plural(rows.count, "time"))"
    case .edit: return "Edited \(plural(distinctFiles(rows), "file"))"
    case .run: return runHeading(rows)
    case .check:
        let failed = rows.filter(rowFailed).count
        return "Ran \(plural(rows.count, "check"))" + (failed > 0 ? " · \(failed) failed" : "")
    case .commit: return "Committed \(plural(rows.count, "time"))"
    case .tool:
        let agents = rows.allSatisfy { $0.calls.allSatisfy { $0.kind == "agent" } }
        return agents ? "Ran \(plural(rows.count, "agent"))" : "Used \(plural(rows.count, "tool"))"
    }
}

/// Commands all of one program say which: "Ran rg 3 times".
private func runHeading(_ rows: [TraceRow]) -> String {
    let programs = Set(rows.map { row in
        guard case .run(let what) = row.action else { return row.id }
        return String(what.split(separator: " ", omittingEmptySubsequences: false)[0])
    })
    if programs.count == 1, let program = programs.first { return "Ran \(program) \(rows.count) times" }
    return "Ran \(plural(rows.count, "command"))"
}

/// The verb a row leads with, past or, while it runs, present. Tools draw their own row.
public func actionVerb(_ row: TraceRow, live: Bool = false) -> String {
    switch row.action {
    case .read: live ? "Reading" : "Read"
    case .image: live ? "Looking at" : "Looked at"
    case .search: live ? "Searching" : "Searched"
    case .web: live ? "Searching the web for" : "Searched the web for"
    case .edit: live ? "Editing" : "Edited"
    case .create: live ? "Writing" : "Wrote"
    case .test(_, let failed): live ? "Running tests" : failed ? "Tests failed" : "Tests passed"
    case .check(let name, let failed): live ? "Running \(name)" : "\(capitalized(name)) \(failed ? "failed" : "passed")"
    case .commit: live ? "Committing" : "Committed"
    case .git: live ? "Checking" : "Checked"
    case .run: live ? "Running" : "Ran"
    case .tool: ""
    }
}

private func capitalized(_ text: String) -> String {
    text.prefix(1).uppercased() + text.dropFirst()
}

/// A grep's alternation reads as its first word, without its escapes.
public func shortPattern(_ pattern: String) -> String {
    let alternative = pattern.components(separatedBy: "\\|")[0]
    let first = alternative
        .replacing(#/^\^|\\b|\$$/#, with: "")
        .replacing(#/\\(.)/#) { String($0.output.1) }
    return first.count > 34 ? first.prefix(32) + "…" : first
}

/// Where a search looked: a path's last two folders.
public func shortWhere(_ place: String) -> String {
    let parts = place.components(separatedBy: " ")[0].split(separator: "/").map(String.init)
    return parts.count > 2 ? "…/" + parts.suffix(2).joined(separator: "/") : parts.joined(separator: "/")
}

/// A search that looked in one file, which reads as the file rather than a folder.
public func searchedOneFile(_ place: String) -> Bool {
    !place.contains(" ") && place.firstMatch(of: #/\.\w+$/#) != nil
}
