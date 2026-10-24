import Foundation

// shared/activity-labels.ts and shared/asked-questions.ts, so the phone words a
// turn as the desktop does. ts-trace.json checks them against the TypeScript.

/// "12s", "3m 4s".
public func duration(ms: Int64) -> String {
    let seconds = max(0, ms / 1000)
    return seconds < 60 ? "\(seconds)s" : "\(seconds / 60)m \(seconds % 60)s"
}

public func plural(_ count: Int, _ one: String, _ many: String? = nil) -> String {
    "\(count) \(count == 1 ? one : many ?? one + "s")"
}

/// A native question call, kept apart from ordinary tool calls.
public func isQuestionCall(_ a: AgentActivity) -> Bool {
    a.kind == "tool" && (a.label == "AskUserQuestion" || a.label == "request_user_input")
}

/// A finished question call's questions and answers: Codex keeps pairs, Claude
/// Code writes them in its result (`The user answered: "Q"="A", …`).
public func askedQuestions(_ a: AgentActivity) -> [AskedQuestion]? {
    guard isQuestionCall(a), a.status == "complete" else { return nil }
    if let pairs = a.questionAnswers, !pairs.isEmpty { return pairs }
    guard let detail = a.detail else { return nil }
    let pairs = detail.matches(of: #/"([^"]+?)"="([\s\S]*?)"(?=, "[^"]+?"="|\.(?:\s|$)|$)/#).map {
        AskedQuestion(
            question: String($0.output.1).trimmingCharacters(in: .whitespacesAndNewlines),
            answer: String($0.output.2).trimmingCharacters(in: .whitespacesAndNewlines))
    }
    return pairs.isEmpty ? nil : pairs
}

private let summaries: [String: @Sendable (Int) -> String] = [
    "read": { "Read \(plural($0, "file"))" },
    "file": { "Edited \(plural($0, "file"))" },
    "command": { "Ran \(plural($0, "command"))" },
    "search": { "Searched code \(plural($0, "time"))" },
    "web": { "Searched the web \(plural($0, "time"))" },
    "agent": { "Ran \(plural($0, "agent"))" },
    "tool": { "Used \(plural($0, "tool"))" },
]
/// The order kinds first appear in, as a JS Map keeps it.
private let kindOrder = ["read", "file", "command", "search", "web", "agent", "tool"]

/// The files one edit call wrote: "a.ts +2 more" names them one per line in `detail`.
private func editedFiles(_ a: AgentActivity) -> [String] {
    guard let more = a.label.firstMatch(of: #/ \+(\d+) more$/#), let n = Int(more.output.1) else { return [a.label] }
    let paths = a.detail?.components(separatedBy: "\n") ?? []
    return paths.count == n + 1 ? paths : (0...n).map { "\(a.id)\n\($0)" }
}

/// "Read 3 files, ran 2 commands, and edited 1 file"; `dropped` adds the calls a long turn let go of.
public func summarizeActivity(_ activity: [AgentActivity], dropped: [String: Int] = [:]) -> String {
    var groups: [(kind: String, seen: [String])] = []
    var failed = Set<String>(), stopped = Set<String>(), running = Set<String>()
    var questions = 0
    for a in activity {
        if isQuestionCall(a) && a.status == "complete" {
            questions += askedQuestions(a)?.count ?? 1
            continue
        }
        if a.status != "complete" {
            switch a.status {
            case "failed": failed.insert(a.id)
            case "stopped": stopped.insert(a.id)
            default: running.insert(a.id)
            }
            continue
        }
        let keys = a.kind == "file" ? editedFiles(a) : [a.kind == "read" ? a.label : a.id]
        if let at = groups.firstIndex(where: { $0.kind == a.kind }) {
            for key in keys where !groups[at].seen.contains(key) { groups[at].seen.append(key) }
        } else {
            var unique: [String] = []
            for key in keys where !unique.contains(key) { unique.append(key) }
            groups.append((a.kind, unique))
        }
    }
    // The dropped calls came first, in the order the desktop listed them.
    var counts: [(kind: String, n: Int)] = kindOrder.compactMap { kind in
        guard let n = dropped[kind], n > 0 else { return nil }
        return (kind, n)
    }
    for (kind, seen) in groups {
        if let at = counts.firstIndex(where: { $0.kind == kind }) { counts[at].n += seen.count } else { counts.append((kind, seen.count)) }
    }
    var labels = counts.compactMap { summaries[$0.kind]?($0.n) }
    if questions > 0 { labels.append("Asked you \(plural(questions, "question"))") }
    let failures = failed.count + (dropped["failed"] ?? 0)
    if failures > 0 { labels.append("\(plural(failures, "tool call")) failed") }
    if !stopped.isEmpty { labels.append("\(plural(stopped.count, "tool call")) stopped") }
    if !running.isEmpty { labels.append("\(plural(running.count, "tool call")) still running") }
    let parts = labels.enumerated().map { i, text in i == 0 ? text : text.prefix(1).lowercased() + text.dropFirst() }
    if parts.count < 3 { return parts.joined(separator: " and ") }
    return parts.dropLast().joined(separator: ", ") + ", and " + parts.last!
}

private func baseName(_ path: String) -> String {
    path.split(separator: "/").last.map(String.init) ?? path
}

private let commandWrappers: Set<String> = ["sudo", "env", "time", "nice", "nohup", "exec", "command", "npx", "pnpx", "bunx"]
private let commandSetup: Set<String> = [
    "cd", "pushd", "popd", "export", "unset", "set", "source", ".", "true", "[", "[[", "test", "done", "fi", "esac", "}",
]
private let shellLeads: Set<String> = ["if", "elif", "while", "until", "then", "do", "else", "!", "{"]
private let shellHeaders: Set<String> = ["for", "case", "select", "function"]

/// The program a command line is about: "cd app && npx vitest run" is vitest,
/// and Codex's "/bin/zsh -lc 'rg foo'" is rg.
public func programName(_ command: String) -> String? {
    if let shell = command.wholeMatch(of: #/\s*(?:\S*\/)?(?:ba|z|fi)?sh\s+-\w*c\s+(['"])([\s\S]*)\1\s*/#) {
        return programName(String(shell.output.2))
    }
    for segment in command.split(separator: #/&&|\|\||[;|\n]/#, omittingEmptySubsequences: false) {
        var words = segment.trimmingCharacters(in: .whitespacesAndNewlines).split(whereSeparator: \.isWhitespace).map(String.init)
        while let first = words.first,
            commandWrappers.contains(first) || shellLeads.contains(first) || first.prefixMatch(of: #/\w+=/#) != nil
        {
            words.removeFirst()
        }
        guard let raw = words.first else { continue }
        let word = raw.replacing(#/^["'(]+|["')]+$/#, with: "")
        if word.isEmpty || commandSetup.contains(word) || shellHeaders.contains(word) { continue }
        let last = word.split(separator: "/", omittingEmptySubsequences: false).last.map(String.init) ?? ""
        return last.isEmpty ? word : last
    }
    return nil
}

/// The past-tense line for a finished call: "Ran rg", "Read AgentTurn.tsx".
public func doneLabel(_ a: AgentActivity) -> String {
    if isQuestionCall(a) {
        return a.status == "complete" ? "Asked you \(plural(askedQuestions(a)?.count ?? 1, "question"))" : "Didn't get your answer"
    }
    let program = { programName(a.label) ?? "command" }
    switch (a.status, a.kind) {
    case ("failed", "command"): return "Failed \(program())"
    case ("failed", "read"): return "Failed to read \(baseName(a.label))"
    case ("failed", "file"): return "Failed to edit \(baseName(a.label))"
    case ("failed", "search"): return "Search failed: \(a.label)"
    case ("failed", "web"): return "Web search failed"
    case ("failed", "agent"): return "Agent failed: \(a.label)"
    case ("failed", "tool"): return "Tool failed: \(callLabel(a))"
    case ("stopped", "command"): return "Stopped \(program())"
    case ("stopped", "read"): return "Stopped reading \(baseName(a.label))"
    case ("stopped", "file"): return "Stopped editing \(baseName(a.label))"
    case ("stopped", "search"): return "Search stopped: \(a.label)"
    case ("stopped", "web"): return "Web search stopped"
    case ("stopped", "agent"): return "Agent stopped: \(a.label)"
    case ("stopped", "tool"): return "Stopped: \(callLabel(a))"
    case (_, "command"): return "Ran \(program())"
    case (_, "read"): return "Read \(baseName(a.label))"
    case (_, "file"): return "Edited \(baseName(a.label))"
    case (_, "search"): return "Searched for \(a.label)"
    case (_, "web"): return "Searched the web"
    default: return callLabel(a)
    }
}

/// The present-tense line while a call runs: "Reading AgentTurn.tsx".
public func liveLabel(_ a: AgentActivity) -> String {
    if isQuestionCall(a) { return "Waiting for your answer" }
    switch a.kind {
    case "command": return "Running \(programName(a.label) ?? "command")"
    case "read": return "Reading \(baseName(a.label))"
    case "file": return "Editing \(baseName(a.label))"
    case "search": return "Searching for \(a.label)"
    case "web": return "Searching the web"
    default: return callLabel(a)
    }
}

/// electron/relay-mcp/tool-meta.ts relayToolMeta's labels: keep the two the same. The desktop words
/// Relay's own tools when the call is made, so a turn from before a tool had its words
/// still says "relay: add_note"; the phone words those again.
let relayToolLabels = [
    "start_threads": "Started threads",
    "list_threads": "Checked on started threads",
    "find_threads": "Looked through threads",
    "read_thread": "Read a thread",
    "send_to_thread": "Messaged a started thread",
    "wait_for_threads": "Waited for started threads",
    "stop_thread": "Stopped a started thread",
    "hand_off_thread": "Moved a thread to another computer",
    "settle_thread": "Settled a started thread",
    "settle_this_thread": "Settles this thread when done",
    "wake_this_thread": "Set a wake-up",
    "move_to_worktree": "Moved the thread to its own worktree",
    "deep_review": "Started a deep review",
    "list_review_setups": "Listed review setups",
    "list_notes": "Read the notes",
    "add_note": "Added a note",
    "tick_note": "Ticked an item in the notes",
    "usage_limits": "Checked usage limits",
    "list_agents": "Listed agents",
    "list_projects": "Listed projects",
    "add_project": "Added a project",
    "restart_relay": "Restarted Relay",
    "report_relay_problem": "Drafted a report about Relay",
    "show_html": "Showed a page",
    "preview_html": "Looked at a page",
    "ask_html": "Asked with a page",
    "open_preview": "Opened the preview",
    "screenshot": "Looked at the preview",
    "console_errors": "Read the preview's console",
    "import_sources": "Looked at what to import",
    "offer_import": "Offered what to import",
    "list_schedules": "Checked the schedules",
    "add_schedule": "Set up a schedule",
    "update_schedule": "Changed a schedule",
    "pause_schedule": "Paused or resumed a schedule",
    "remove_schedule": "Removed a schedule",
    "run_schedule": "Test-ran a schedule",
]

/// A call's label, with Relay's own tools in words even where the desktop sent their raw name.
public func callLabel(_ a: AgentActivity) -> String {
    guard let mcp = a.mcp, mcp.server == "relay", a.label == "relay: \(mcp.tool)" else { return a.label }
    return relayToolLabels[mcp.tool] ?? a.label
}
