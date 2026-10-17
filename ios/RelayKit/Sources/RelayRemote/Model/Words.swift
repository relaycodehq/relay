import Foundation

// The thread's small wording (shared/ tokens, thread-cost, session-reload,
// worktree-command and chat-activity's clock words), as Android's Words.kt
// and Times.kt show them.

private func oneDecimal(_ value: Double) -> String {
    let s = String(format: "%.1f", locale: Locale(identifier: "en_US_POSIX"), value)
    return s.hasSuffix(".0") ? String(s.dropLast(2)) : s
}

/// "812", "4.2k", "38k", "1.2M".
public func formatTokens(_ value: Double) -> String {
    if value < 1_000 { return "\(Int(value.rounded()))" }
    if value < 10_000 { return "\(oneDecimal(value / 1_000))k" }
    if value < 1_000_000 { return "\(Int((value / 1_000).rounded()))k" }
    return "\(oneDecimal(value / 1_000_000))M"
}

/// "281k → 8.9k tokens", or as much of it as the agent reported.
public func compactedTokens(_ before: Double?, _ after: Double?) -> String {
    let b = before.flatMap { $0 == 0 ? nil : $0 }
    // A reading taken during the compaction itself is no smaller than before.
    let a = after.flatMap { $0 == 0 || (b != nil && $0 >= b!) ? nil : $0 }
    switch (b, a) {
    case let (b?, a?): return "\(formatTokens(b)) → \(formatTokens(a)) tokens"
    case let (b?, nil): return "from \(formatTokens(b)) tokens"
    case let (nil, a?): return "to \(formatTokens(a)) tokens"
    default: return ""
    }
}

public func formatDollars(_ value: Double) -> String {
    let v = abs(value)
    let f = NumberFormatter()
    f.locale = Locale(identifier: "en_US")
    f.numberStyle = .decimal
    let digits = v >= 100 || v == v.rounded(.down) ? 0 : 2
    f.minimumFractionDigits = digits
    f.maximumFractionDigits = digits
    return "\(value < 0 ? "−" : "")$\(f.string(from: NSNumber(value: v)) ?? "\(v)")"
}

public func formatCost(_ usd: Double) -> String { usd < 0.01 ? "<$0.01" : formatDollars(usd) }

/// Tokens the answer wrote, from its `streamed` reading.
public func streamedOutput(_ streamed: JSON?) -> Double? { streamed?.object?["output"]?.number }

/// An answer's speed worth showing, in tokens a second; none under 50 tokens.
public func answerSpeed(_ streamed: JSON?) -> Int? {
    guard let output = streamedOutput(streamed), let ms = streamed?.object?["ms"]?.number,
        output >= 50, ms > 0
    else { return nil }
    return Int((output * 1000 / ms).rounded())
}

/// "38k out · 74 tok/s · $0.42", or as much as the answer says.
public func answerStats(_ m: ChatMessage) -> String? {
    var parts: [String] = []
    if let output = streamedOutput(m.streamed), let speed = answerSpeed(m.streamed) {
        parts.append("\(formatTokens(output)) out · \(speed) tok/s")
    }
    if let cost = m.cost, cost > 0 { parts.append(formatCost(cost)) }
    return parts.isEmpty ? nil : parts.joined(separator: " · ")
}

private func names(_ reload: JSON, _ key: String, _ side: String) -> Int {
    reload.object?[key]?.object?[side]?.array?.count ?? 0
}

private func count(_ n: Int, _ word: String) -> String { "\(n) \(word)\(n == 1 ? "" : "s")" }

/// "Session reloaded · picked up 2 new skills · 1 agent gone", or "Reloading session…" while live.
public func reloadNote(_ reload: JSON, live: Bool) -> String {
    if live { return "Reloading session…" }
    let kinds = [("skills", "skill"), ("agents", "agent")]
    let added = kinds.compactMap { k, w in names(reload, k, "added") > 0 ? count(names(reload, k, "added"), "new \(w)") : nil }
    let removed = kinds.compactMap { k, w in names(reload, k, "removed") > 0 ? count(names(reload, k, "removed"), w) : nil }
    var parts = ["Session reloaded"]
    if !added.isEmpty { parts.append("picked up \(added.joined(separator: " and "))") }
    if !removed.isEmpty { parts.append("\(removed.joined(separator: " and ")) gone") }
    return parts.joined(separator: " · ")
}

/// "Setting up the worktree…", "Worktree setup failed (exit 1)" and the like.
public func worktreeCommandNote(_ run: WorktreeCommandRun, status: String) -> String {
    let setup = run.kind == "setup"
    if status == "streaming" { return setup ? "Setting up the worktree…" : "Tearing down the worktree…" }
    if status == "complete" { return setup ? "Worktree set up" : "Worktree torn down" }
    let what = setup ? "Worktree setup" : "Worktree teardown"
    if run.stopped == "timeout" { return "\(what) timed out" }
    if status == "cancelled" || run.stopped == "cancelled" { return "\(what) stopped" }
    if let code = run.exitCode, code > 0 { return "\(what) failed (exit \(code))" }
    return "\(what) failed"
}

/// What setup printed, with what it copied from the project folder first.
public func worktreeCommandOutput(_ run: WorktreeCommandRun) -> String {
    [
        run.copied.flatMap { $0.isEmpty ? nil : "Copied from the project folder: \($0.joined(separator: ", "))" },
        run.output.isEmpty ? nil : run.output,
    ].compactMap { $0 }.joined(separator: "\n\n")
}

/// The phone's clock words, in its own zone and locale.
public struct Clock: Sendable {
    public var calendar: Calendar
    public var locale: Locale

    public init(calendar: Calendar = .current, locale: Locale = .current) {
        self.calendar = calendar
        self.locale = locale
    }

    private func date(_ ms: Int64) -> Date { Date(timeIntervalSince1970: Double(ms) / 1000) }

    private func format(_ ms: Int64, _ template: String) -> String {
        let f = DateFormatter()
        f.calendar = calendar
        f.timeZone = calendar.timeZone
        f.locale = locale
        f.setLocalizedDateFormatFromTemplate(template)
        return f.string(from: date(ms))
    }

    /// "13:25" or "1:25 PM", as the phone's locale writes it.
    public func clock(_ ms: Int64) -> String {
        let f = DateFormatter()
        f.calendar = calendar
        f.timeZone = calendar.timeZone
        f.locale = locale
        f.dateStyle = .none
        f.timeStyle = .short
        return f.string(from: date(ms))
    }

    /// When a message was sent: "13:25", "Yesterday 13:25", "Tuesday 13:25", "Sep 3, 13:25".
    public func sentLabel(_ sent: Int64, now: Int64) -> String {
        let t = clock(sent)
        let days =
            calendar.dateComponents(
                [.day], from: calendar.startOfDay(for: date(sent)), to: calendar.startOfDay(for: date(now))
            ).day ?? 0
        if days <= 0 { return t }
        if days == 1 { return "Yesterday \(t)" }
        if days < 7 { return "\(format(sent, "EEEE")) \(t)" }
        let sameYear = calendar.component(.year, from: date(sent)) == calendar.component(.year, from: date(now))
        return "\(format(sent, sameYear ? "MMMd" : "yMMMd")), \(t)"
    }
}

/// The start of an answer as plain words: no fences, marks or link targets (Android's Words.kt).
public func preview(_ markdown: String, length: Int = 240) -> String {
    var text = markdown
    func sub(_ pattern: String, _ template: String, _ options: NSRegularExpression.Options = []) {
        let re = try! NSRegularExpression(pattern: pattern, options: options)
        text = re.stringByReplacingMatches(in: text, range: NSRange(text.startIndex..., in: text), withTemplate: template)
    }
    sub("```[^\\n]*\\n[\\s\\S]*?(```|$)", " ")
    sub("!\\[([^\\]]*)\\]\\([^)]*\\)", "$1")
    sub("\\[([^\\]]+)\\]\\([^)]*\\)", "$1")
    // A heading with more under it reads as a lead-in.
    let heading = try! NSRegularExpression(
        pattern: "^\\s{0,3}#{1,6}\\s+(.*?)\\s*#*\\s*$(?=\\n\\s*\\S)", options: .anchorsMatchLines)
    for match in heading.matches(in: text, range: NSRange(text.startIndex..., in: text)).reversed() {
        let line = (text as NSString).substring(with: match.range(at: 1))
        let lead = line.range(of: "[.:!?]$", options: .regularExpression) != nil ? line : line + ":"
        text = (text as NSString).replacingCharacters(in: match.range, with: lead)
    }
    sub("^\\s{0,3}(#{1,6}\\s+|>\\s?|[-*+]\\s+|\\d+[.)]\\s+)", "", .anchorsMatchLines)
    sub("(\\*\\*|__|\\*|_|~~|`)(?=\\S)([^\\n]*?\\S)\\1", "$2")
    sub("\\s+", " ")
    text = text.trimmingCharacters(in: .whitespaces)
    guard text.count > length else { return text }
    return String(text.prefix(length - 1)).trimmingCharacters(in: .whitespaces) + "…"
}
