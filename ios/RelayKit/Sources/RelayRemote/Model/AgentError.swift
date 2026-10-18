import Foundation

// shared/agent-error.ts (Android's AgentError.kt): an answer's error as the
// reader should see it, the provider's envelope behind "Technical details".

public struct AgentErrorShown: Sendable, Equatable {
    public var message: String
    public var hint: String?
    public var details: String?
    /// The agent's program isn't on this computer; going again won't help.
    public var notInstalled = false
}

private let detailsMark = "\n\nTechnical details:\n"

private func envelopeMessage(_ value: JSON?) -> String? {
    switch value {
    case .string(let s)?:
        let t = s.trimmingCharacters(in: .whitespacesAndNewlines)
        return t.isEmpty ? nil : t
    case .object(let o)?:
        if let inner = envelopeMessage(o["error"]) { return inner }
        let t = o["message"]?.string?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return t.isEmpty ? nil : t
    default: return nil
    }
}

public func agentError(_ error: String) -> AgentErrorShown {
    if let at = error.range(of: detailsMark) {
        var shown = agentError(String(error[..<at.lowerBound]))
        shown.details = String(error[at.upperBound...])
        return shown
    }
    let raw = error.trimmingCharacters(in: .whitespacesAndNewlines)
    // Older desktops said "AI models"; their stored errors still reach the phone.
    if let m = raw.wholeMatch(
        of: #/(\S+) was not found\. Install it in Settings → AI (?:models|& agents) → Agents, or put it on PATH\./#)
    {
        return AgentErrorShown(
            message: "\(m.output.1) isn't installed on this computer.",
            hint: "Set it up in Settings → AI & agents → Agents, or put it on PATH, then send again.",
            notInstalled: true)
    }
    var message = raw
    var structured = false
    if let start = raw.firstIndex(of: "{"), let value = try? JSON.parse(String(raw[start...])) {
        message = envelopeMessage(value) ?? "The agent couldn't finish this answer."
        structured = true
    }
    if let m = message.wholeMatch(
        of: #/The ['"]([^'"]+)['"] model is not supported when using Codex with a ChatGPT account\.?/#.ignoresCase())
    {
        return AgentErrorShown(
            message: "\(m.output.1) isn't available with your ChatGPT account.",
            hint: "Choose a different model in the composer, then resume the answer.", details: error)
    }
    return AgentErrorShown(message: message, details: structured ? error : nil)
}
