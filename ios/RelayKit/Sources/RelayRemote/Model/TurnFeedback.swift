import Foundation

// shared/turn-feedback.ts (Android's TurnFeedback.kt): the buzz a phone gives
// for the thread on its screen.

public enum TurnFeedback: Sendable, Equatable {
    case success, error, warning
}

public struct TurnAnswer: Sendable, Equatable {
    public var created: Int64
    public var status: String

    public init(created: Int64, status: String) {
        self.created = created
        self.status = status
    }
}

public struct TurnSight: Sendable, Equatable {
    public var running: Bool
    public var since: Int64?
    public var waiting: Bool
    public var answer: TurnAnswer?

    public init(running: Bool, since: Int64? = nil, waiting: Bool, answer: TurnAnswer? = nil) {
        self.running = running
        self.since = since
        self.waiting = waiting
        self.answer = answer
    }
}

public struct TurnWatch: Sendable, Equatable {
    var running: Bool
    var waiting: Bool
    var since: Int64?
    /// A turn that stopped running whose answer hasn't finished yet: when it started.
    var ended: Int64?
    /// A finished answer already there at the first look.
    var ignoredAnswer: Int64?
    /// When the turn whose end already buzzed started, so it can't end twice.
    var told: Int64?
}

/// Compares a thread with how it last looked and says what to buzz, once per
/// change: a question appearing, or a turn ending in its answer finishing or
/// failing. With nothing to compare with it only takes note.
public func watchTurn(_ last: TurnWatch?, _ sight: TurnSight) -> (TurnWatch, TurnFeedback?) {
    var watch = TurnWatch(
        running: sight.running, waiting: sight.waiting,
        since: sight.running ? sight.since ?? last?.since : nil,
        ignoredAnswer: last != nil ? last?.ignoredAnswer : sight.answer.flatMap { $0.status == "streaming" ? nil : $0.created },
        told: last?.told)
    guard let last else { return (watch, nil) }
    let asked = sight.waiting && !last.waiting
    var ended = sight.running ? nil : last.running ? last.since : last.ended
    if ended != nil, ended == last.told { ended = nil }
    var end: TurnFeedback?
    if let e = ended, let answer = sight.answer, answer.created >= e, answer.created != watch.ignoredAnswer,
        answer.status != "streaming"
    {
        if answer.status == "complete" { end = .success }
        if answer.status == "failed" { end = .error }
        watch.told = e
        ended = nil
    }
    if let ended { watch.ended = ended }
    return (watch, asked ? .warning : end)
}
