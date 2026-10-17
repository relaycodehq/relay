import Foundation

// shared/drafts.ts and the Kotlin app's DraftLogic.kt: the composer's text shared between
// the computer and its phones from `Bridge.drafts` on.

/// A composer's text, and what makes the desktop's pills in it.
public struct DraftBody: Codable, Sendable, Equatable {
    public var text: String
    /// Each skill token's label.
    public var skills: [String: String]?
    public var quotes: [String]?
    public var files: [String]?
    /// Where a new thread will work, when picked for it.
    public var workspace: String?

    public init(
        text: String, skills: [String: String]? = nil, quotes: [String]? = nil, files: [String]? = nil,
        workspace: String? = nil
    ) {
        self.text = text
        self.skills = skills
        self.quotes = quotes
        self.files = files
        self.workspace = workspace
    }

    /// The parts every screen carries, with the empty ones left out.
    public var normal: DraftBody {
        DraftBody(
            text: text, skills: skills?.isEmpty == false ? skills : nil, quotes: quotes?.isEmpty == false ? quotes : nil,
            files: files?.isEmpty == false ? files : nil, workspace: workspace?.isEmpty == false ? workspace : nil)
    }

    public func same(as other: DraftBody) -> Bool { normal == other.normal }
}

/// What only the computer's composer holds of a draft. A phone shows that it's there, and
/// while any is, the phone's send goes through the computer, which adds it.
public struct DraftExtras: Codable, Sendable, Equatable {
    /// Its screenshots, by their `[Image #n]` token.
    public var screenshots: [Int]?
    public var codeRefs: Int?
    public var selection: Bool?
    public var workItem: Bool?
    public var links: Int?
    /// "pr" or "review": a new thread written for a pull request or a review.
    public var scope: String?
    /// A new thread's own branch name.
    public var branch: Bool?

    public init(
        screenshots: [Int]? = nil, codeRefs: Int? = nil, selection: Bool? = nil, workItem: Bool? = nil,
        links: Int? = nil, scope: String? = nil, branch: Bool? = nil
    ) {
        self.screenshots = screenshots
        self.codeRefs = codeRefs
        self.selection = selection
        self.workItem = workItem
        self.links = links
        self.scope = scope
        self.branch = branch
    }

    /// Anything at all: a draft holding only these still counts.
    public var any: Bool { self != DraftExtras() }
}

/// What a clash replaced, until it's used or dropped.
public struct DraftOther: Codable, Sendable, Equatable {
    public var text: String
    /// "desktop" or "phone:<deviceId>"
    public var by: String
    public var at: Int64

    public init(text: String, by: String, at: Int64) {
        self.text = text
        self.by = by
        self.at = at
    }
}

/// The computer's copy of a draft.
public struct SharedDraft: Codable, Sendable, Equatable {
    public var key: String
    /// Bumped by every change the computer takes; a write names the one it was edited from.
    public var rev: Int64
    /// When it was last edited, on the clock of whoever edited it.
    public var at: Int64
    /// "desktop" or "phone:<deviceId>"
    public var by: String
    /// Where it was started.
    public var origin: String
    public var text: String
    public var skills: [String: String]?
    public var quotes: [String]?
    public var files: [String]?
    public var workspace: String?
    public var extras: DraftExtras?
    public var other: DraftOther?

    public init(
        key: String, rev: Int64, at: Int64, by: String, origin: String, text: String, extras: DraftExtras? = nil,
        other: DraftOther? = nil
    ) {
        self.key = key
        self.rev = rev
        self.at = at
        self.by = by
        self.origin = origin
        self.text = text
        self.extras = extras
        self.other = other
    }

    public var body: DraftBody {
        DraftBody(text: text, skills: skills, quotes: quotes, files: files, workspace: workspace).normal
    }
}

/// A phone's edit of a draft.
public struct DraftWrite: Codable, Sendable, Equatable {
    public var key: String
    /// The rev it was edited from; 0 for a draft the writer hadn't seen.
    public var base: Int64
    public var at: Int64
    public var text: String
    public var skills: [String: String]?
    public var quotes: [String]?
    public var files: [String]?
    public var workspace: String?
    /// Emptied because this text went out, not cleared away.
    public var sent: String?

    public init(key: String, base: Int64, at: Int64, body: DraftBody, sent: String? = nil) {
        self.key = key
        self.base = base
        self.at = at
        text = body.text
        skills = body.skills
        quotes = body.quotes
        files = body.files
        workspace = body.workspace
        self.sent = sent
    }
}

/// A change pushed to every screen; `draft` is nil once it's gone.
public struct DraftChange: Codable, Sendable, Equatable {
    public var key: String
    public var draft: SharedDraft?
    /// It went out, from wherever.
    public var sent: Bool?

    public init(key: String, draft: SharedDraft?, sent: Bool? = nil) {
        self.key = key
        self.draft = draft
        self.sent = sent
    }
}

public func phoneDevice(_ deviceId: String) -> String { "phone:\(deviceId)" }

/// A key the computer takes: a thread's (`chatId`), a reply's (`chatId:rootId`) or a new
/// thread's (`new:projectId:stamp`).
public func isShareableDraftKey(_ key: String) -> Bool {
    let id = "[A-Za-z0-9_-]{1,80}"
    return key.range(of: "^(?:\(id)(?::\(id))?|new:\(id)(?::[a-z0-9]{1,16})?)$", options: .regularExpression) != nil
}

/// The project a new thread's draft is for, from its key (`new:projectId:stamp`).
public func newDraftProject(_ key: String) -> String? {
    guard let match = key.firstMatch(of: #/^new:([^:]+)(?::[^:]+)?$/#) else { return nil }
    return String(match.1)
}

/// A screen's copy of a draft, and how it stands with the computer's.
public protocol LocalDraft {
    var body: DraftBody { get }
    /// The desktop's, which count as a draft without any text.
    var extras: DraftExtras? { get }
    /// The computer's rev it last matched.
    var synced: Int64? { get }
    /// When it was edited here without the computer taking it yet.
    var dirty: Int64? { get }
}

public struct Reconciled: Equatable {
    public var take: [SharedDraft] = []
    public var drop: [String] = []
    public var push: [String] = []
}

/// What a screen does once it hears the computer's drafts: take the computer's copy, drop its
/// own once the computer no longer has it, and push what changed here meanwhile or never went.
public func reconcileDrafts(_ local: [(key: String, draft: any LocalDraft)], _ shared: [SharedDraft]) -> Reconciled {
    var out = Reconciled()
    let theirs = Dictionary(shared.map { ($0.key, $0) }, uniquingKeysWith: { _, last in last })
    for (key, mine) in local {
        let draft = theirs[key]
        let typed = !(mine.body.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && mine.extras?.any != true)
        if mine.dirty != nil || (mine.synced == nil && typed && draft == nil) {
            out.push.append(key)
        } else if let draft, mine.synced != draft.rev {
            // Never synced, but there: the same thing typed on both is no clash.
            if mine.synced == nil && typed && !mine.body.same(as: draft.body) { out.push.append(key) } else { out.take.append(draft) }
        } else if draft == nil && mine.synced != nil {
            out.drop.append(key)
        }
    }
    let keys = Set(local.map(\.key))
    out.take += shared.filter { !keys.contains($0.key) }
    return out
}

/// "2 screenshots, a code reference and a selected line": what stays on the computer.
public func extrasSummary(_ extras: DraftExtras?) -> String {
    guard let extras else { return "" }
    func count(_ n: Int, _ one: String) -> String { n == 1 ? "a \(one)" : "\(n) \(one)s" }
    let parts = [
        extras.screenshots.flatMap { $0.isEmpty ? nil : count($0.count, "screenshot") },
        extras.codeRefs.flatMap { $0 > 0 ? count($0, "code reference") : nil },
        extras.selection == true ? "a selected line" : nil,
        extras.workItem == true ? "a work item" : nil,
        extras.links.flatMap { $0 > 0 ? count($0, "linked folder") : nil },
        extras.scope == "pr" ? "a pull request" : nil,
        extras.scope == "review" ? "a review" : nil,
        extras.branch == true ? "a branch name" : nil,
    ].compactMap { $0 }
    guard parts.count > 1 else { return parts.first ?? "" }
    return parts.dropLast().joined(separator: ", ") + " and " + parts.last!
}

public extension RemoteClient {
    /// The phone's edit of a draft; the draft as it stands after, nil once gone. From `Bridge.drafts`.
    func saveDraft(_ write: DraftWrite) async throws -> SharedDraft? {
        let after = try await call("saveDraft", [try JSON(encoding: write)])
        return after == .null ? nil : try after.decode()
    }

    /// Swaps in the version a clash kept, or with `drop` lets it go. From `Bridge.drafts`.
    func draftOther(key: String, drop: Bool) async throws -> SharedDraft? {
        let after = try await call("draftOther", [.string(key), .bool(drop)])
        return after == .null ? nil : try after.decode()
    }

    /// Sends a draft the computer holds part of (a screenshot, a code reference) from its own
    /// composer, with the phone's message; nil `chatId` for a new thread. The thread it went to.
    func sendDraft(key: String, chatId: String?, _ send: ProjectChatSend) async throws -> String {
        let sent = try await call("sendDraft", [.string(key), chatId.map(JSON.string), try JSON(encoding: send)])
        guard let chatId = sent["chatId"]?.string else { throw RemoteCallError.rejected("No thread came back.") }
        return chatId
    }
}
