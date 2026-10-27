import Foundation

// shared/trace-tree.ts: how a finished run of tool calls reads, grouped by what the calls did
// rather than the order they came in. ts-trace-tree.json holds this port to the TypeScript.

/// One row: a thing done, by one call or a few that did the same thing.
public struct TraceRow: Sendable, Equatable, Identifiable {
    public var id: String
    public var action: CallAction
    public var calls: [AgentActivity]
    /// The lines each read of the file printed; none when a read took it whole.
    public var lines: [String]?
    /// A script written, then run straight after.
    public var ranToo = false
}

public enum BranchKind: String, Sendable {
    case read, search, web, edit, run, git, check, commit, tool
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

/// A test or check stopped before it said how it went.
public func verdictStopped(_ row: TraceRow) -> Bool {
    switch row.action {
    case .test(_, let failed), .check(_, let failed): !failed && row.calls.contains { $0.status == "stopped" }
    default: false
    }
}

/// A test or check fails by its result; anything else only when its call failed there.
public func rowFailed(_ row: TraceRow) -> Bool {
    switch row.action {
    case .test(_, let failed), .check(_, let failed): failed
    default: row.calls.contains { $0.status == "failed" && failedAt($0, row.action) }
    }
}

/// Every row failed: only then does the branch or run holding them say it failed.
public func allFailed(_ rows: [TraceRow]) -> Bool {
    !rows.isEmpty && rows.allSatisfy(rowFailed)
}

/// A shell exits with its last command's status, so a failed call failed at the last thing it
/// did: in `git log; cat dir/*`, the cat, not the log.
private func failedAt(_ call: AgentActivity, _ action: CallAction) -> Bool {
    guard let last = shownActions(call).last else { return true }
    return sameThing(last.action, action)
}

/// A run of calls between two lines of commentary, as rows, pairs and branches.
public func traceTree(_ calls: [AgentActivity]) -> [TracePiece] {
    traceRun(calls).pieces
}

/// A run's tree and, once it's longer than two lines, its folded line, from one pass over the calls.
/// A tree of two lines or fewer has no folded line: it shows as it is.
public func traceRun(_ calls: [AgentActivity]) -> (pieces: [TracePiece], summary: String?) {
    let grouped = branches(rowsOf(calls))
    let tree = grouped.flatMap { kind, rows in
        kind == .run ? commandRuns(rows).flatMap { pieces(kind, $0) } : pieces(kind, rows)
    }
    return (tree, tree.count < 3 ? nil : summaryOf(grouped))
}

/// What a call did worth a row, each with where it stands among the call's actions: a commit's own
/// `git log` says nothing new, and a running call has only started its first part.
func shownActions(_ call: AgentActivity) -> [(action: CallAction, index: Int)] {
    let actions = (call.actions ?? [.tool]).enumerated().map { (action: $0.element, index: $0.offset) }
    if call.status == "running" { return Array(actions.prefix(1)) }
    let commits = actions.contains { $0.action.kind == "commit" }
    return commits ? actions.filter { $0.action.kind != "git" } : actions
}

/// Whether a row shows what its call printed: a call that did several things prints it under the
/// row of the first, and its other rows show only what ran.
public func showsOutput(_ row: TraceRow, _ call: AgentActivity) -> Bool {
    let shown = shownActions(call)
    guard shown.count > 1 else { return true }
    return sameThing(row.action, shown[0].action)
}

/// Two actions about one thing; reads of a file are, whatever lines each kept.
private func sameThing(_ a: CallAction, _ b: CallAction) -> Bool {
    guard a.kind == b.kind else { return false }
    if let file = a.file, let other = b.file { return file == other }
    return a == b
}

/// A row per thing done; a file read twice running, or a script written then run, share one. A row
/// is named by its call and action, so it keeps its id when a call before it finishes and grows rows.
public func rowsOf(_ calls: [AgentActivity]) -> [TraceRow] {
    var rows: [TraceRow] = []
    for call in calls {
        for (action, index) in shownActions(call) {
            if let last = rows.indices.last, sameRead(rows[last].action, action) {
                if !rows[last].calls.contains(where: { $0.id == call.id }) { rows[last].calls.append(call) }
                rows[last].lines = linesOfBoth(rows[last].lines, readLines(action))
                continue
            }
            if let last = rows.indices.last, ranWhatItWrote(rows[last].action, action) {
                // A command that writes a script and runs it is one call, said once.
                if !rows[last].calls.contains(where: { $0.id == call.id }) { rows[last].calls.append(call) }
                rows[last].ranToo = true
                continue
            }
            rows.append(TraceRow(id: "\(call.id):\(index)", action: action, calls: [call], lines: readLines(action)))
        }
    }
    return rows
}

private func readLines(_ action: CallAction) -> [String]? {
    guard case .read(_, let lines?) = action else { return nil }
    return [lines]
}

/// Two reads of a file together: each one's lines, or none once either took the whole file.
private func linesOfBoth(_ earlier: [String]?, _ later: [String]?) -> [String]? {
    guard let earlier, let later else { return nil }
    return earlier + later
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
    case .edit(let file), .create(let file), .delete(let file): isScratch(file) ? .run : .edit
    case .test, .check: .check
    case .commit: .commit
    case .git: .git
    case .tool: .tool
    case .run: .run
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
            branch[at].lines = linesOfBoth(branch[at].lines, row.lines)
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
private let pairVerbs: Set<String> = ["read", "search", "web", "edit", "create", "delete", "run", "git"]

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
    case .search: return "Searched \(times(rows.count))"
    case .web: return "Searched the web \(times(rows.count))"
    case .edit: return "Edited \(plural(distinctFiles(rows), "file"))"
    case .run: return runHeading(rows)
    case .git: return "Checked git \(times(rows.count))"
    case .check:
        let failed = rows.filter(rowFailed).count
        return "Ran \(plural(rows.count, "check"))" + (failed > 0 ? " · \(failed) failed" : "")
    case .commit: return "Committed \(times(rows.count))"
    case .tool:
        let agents = rows.allSatisfy { $0.calls.allSatisfy { $0.kind == "agent" } }
        return agents ? "Ran \(plural(rows.count, "agent"))" : "Used \(plural(rows.count, "tool"))"
    }
}

/// "once", "twice", "3 times": a run's folded line can name one or two.
private func times(_ count: Int) -> String {
    switch count {
    case 1: "once"
    case 2: "twice"
    default: "\(count) times"
    }
}

/// Commands all of one program say which: "Ran rg 3 times". Counted as the rows under it.
private func runHeading(_ rows: [TraceRow]) -> String {
    let programs = Set(rows.map { row in
        guard case .run(let what) = row.action else { return row.id }
        return String(what.split(separator: " ", omittingEmptySubsequences: false)[0])
    })
    guard programs.count == 1, let program = programs.first else { return "Ran \(plural(rows.count, "command"))" }
    return rows.count == 1 ? "Ran \(program)" : "Ran \(program) \(rows.count) times"
}

/// How many kinds a folded run's line names before "and N more".
private let summaryKinds = 3

/// A run the agent has moved on from, as one line: "Searched twice, read 4 files and ran 3 commands".
private func summaryOf(_ grouped: [(BranchKind, [TraceRow])]) -> String {
    let parts = grouped.enumerated().map { index, branch in
        let heading = branchHeading(branch.0, branch.1)
        return index == 0 ? heading : heading.prefix(1).lowercased() + heading.dropFirst()
    }
    if parts.count > summaryKinds {
        return parts.prefix(summaryKinds - 1).joined(separator: ", ") + " and \(parts.count - summaryKinds + 1) more"
    }
    guard let last = parts.last, parts.count > 1 else { return parts.first ?? "" }
    return parts.dropLast().joined(separator: ", ") + " and " + last
}

/// The verb a row leads with, past or, while it runs, present. Tools draw their own row.
/// A script written and then running is running.
public func actionVerb(_ row: TraceRow, live: Bool = false) -> String {
    if live, row.ranToo { return "Running" }
    return switch row.action {
    case .read: live ? "Reading" : "Read"
    case .image: live ? "Looking at" : "Looked at"
    case .search: live ? "Searching" : "Searched"
    case .web: live ? "Searching the web for" : "Searched the web for"
    case .edit: live ? "Editing" : "Edited"
    case .create: live ? "Writing" : "Wrote"
    case .delete: live ? "Deleting" : "Deleted"
    case .test: live ? "Running tests" : "Tests \(verdictWord(row))"
    case .check(let name, _): live ? "Running \(name)" : "\(capitalized(name)) \(verdictWord(row))"
    case .commit: live ? "Committing" : "Committed"
    case .git: live ? "Checking" : "Checked"
    case .run: live ? "Running" : "Ran"
    case .tool: ""
    }
}

private func verdictWord(_ row: TraceRow) -> String {
    if rowFailed(row) { return "failed" }
    return verdictStopped(row) ? "stopped" : "passed"
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
