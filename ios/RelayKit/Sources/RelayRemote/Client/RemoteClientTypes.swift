import Foundation

public enum LinkState: Sendable, Equatable {
    case connecting
    case online
    case offline
    case denied
}

public struct RemoteStatus: Sendable, Equatable {
    public var state: LinkState
    public var detail: String?

    public init(_ state: LinkState, _ detail: String? = nil) {
        self.state = state
        self.detail = detail
    }
}

/// How a client starts: trading a pairing code, or signing in with saved credentials.
public enum RemoteStart: Sendable, Equatable {
    case pair(PairingLink, device: String, kind: String? = nil)
    case saved(RemoteCredentials)

    var name: String {
        switch self {
        case .pair(let link, _, _): link.name
        case .saved(let credentials): credentials.name
        }
    }

    var credentials: RemoteCredentials? {
        if case .saved(let c) = self { c } else { nil }
    }
}

public struct RemoteRoute: Sendable, Equatable {
    public var host: String
    public var kind: RouteKind
}

public struct RemoteClientOptions: Sendable {
    /// Per host while connecting, and per call.
    public var timeout: Duration = .seconds(15)
    /// How long one route gets before the next is tried beside it.
    public var stagger: Duration = .milliseconds(1500)
    /// How often a link on a later route looks for an earlier one.
    public var betterRoute: Duration = .seconds(60)
    /// Per call for the slow method lists.
    public var slowTimeout: Duration = .seconds(120)
    /// Silence after which a link counts as dead; the desktop ticks every 15s.
    public var stale: Duration = .seconds(40)
    /// A route that lost to the current one isn't tried again for this long.
    public var worseCooldown: Duration = .seconds(300)

    public init() {}
}

/// What the client tells its owner, in order.
public enum RemoteUpdate: Sendable {
    case status(RemoteStatus)
    case event(RemoteEvent)
    /// First contact traded the pairing code for these; keep them to reconnect.
    case paired(RemoteCredentials)
    /// The desktop named new addresses, or the route order changed; keep these instead.
    case credentials(RemoteCredentials)
}

/// What the phone hears, once patches are applied.
public enum RemoteEvent: Sendable, Equatable {
    case message(chatId: String, message: ChatMessage, title: String?)
    case chats([RemoteChatSummary])
    case appearance(PhoneAppearance)
    /// Someone came to the computer (just before the thread list it applies to) or left it (just after).
    case presence(Bool)
    case draft(DraftChange)
    /// Computers only; a phone ignores it.
    case handoff(JSON)
}

public enum RemoteCallError: LocalizedError, Equatable, CustomStringConvertible {
    case notConnected(String)
    /// The call went out but no answer came back: the desktop may have done it all the same.
    case unanswered(String)
    /// The request was refused before it could run.
    case rejected(String)

    public var description: String {
        switch self {
        case .notConnected(let m), .unanswered(let m), .rejected(let m): m
        }
    }

    /// What `localizedDescription` shows: the desktop's own words.
    public var errorDescription: String? { description }
}

/// Why a route didn't sign in. `denied` is the pinned desktop refusing this phone, for every route.
enum DialError: Error {
    case failed(String)
    case denied(String)
    /// The phone itself kept the route closed; worth more than another route's "didn't answer".
    case blocked(String)

    var message: String {
        switch self {
        case .failed(let m), .denied(let m), .blocked(let m): m
        }
    }
}
