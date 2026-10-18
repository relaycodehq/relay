import Foundation

/// `projectChatSendSchema`, strict on the desktop: anything unset stays out.
public struct ProjectChatSend: Codable, Sendable, Equatable {
    public var id: String
    public var body: String
    public var choice: ModelChoice
    public var provider: String
    public var runtimeMode: String
    public var interactionMode: String
    /// "queue" | "steer"
    public var delivery: String?
    public var sendAt: Int64?
    /// Only "200k".
    public var contextWindow: String?
    public var account: String?
    /// An agent, or "message" for a note. Dropped for desktops before `Bridge.recipient`.
    public var to: String?
    public var parentId: String?
    /// Asks `/btw`: starts a side conversation instead of a turn of the main one.
    public var side: Bool?
    /// At most 3.
    public var images: [PastedImage]?

    /// A message to the agent `settings` name, Fast and Claude's window kept
    /// only where that agent has them. Like every composer's, the body starts
    /// with a mention of that agent: desktops before `to` read who answers
    /// from it, and it lets a photo go without text.
    public init(
        id: String = UUID().uuidString.lowercased(), body: String, settings: ResumeSettings,
        delivery: String? = nil, images: [PastedImage] = [], parentId: String? = nil, side: Bool = false,
        sendAt: Int64? = nil
    ) {
        let text = body.trimmingCharacters(in: .whitespacesAndNewlines)
        let to = sendRecipient(text, picked: settings.provider)
        // Another agent named in the text runs on its Default: the picked model is the picked agent's.
        let picked = to == settings.provider
        let mentioned = agentMention(text) != nil || !builtinAgents.contains(to)
        self.id = id
        self.body = mentioned ? text : "@\(to) \(text)".trimmingCharacters(in: .whitespaces)
        choice = picked ? settings.choice : ModelChoice(model: "")
        choice.fast = fastFor(to, choice.fast)
        provider = to
        self.to = to
        runtimeMode = settings.runtimeMode
        interactionMode = settings.interactionMode
        contextWindow = picked ? windowFor(to, model: choice.model, settings.contextWindow) : nil
        self.delivery = delivery
        self.images = images.isEmpty ? nil : images
        self.parentId = parentId
        self.side = side ? true : nil
        self.sendAt = sendAt
    }
}

public extension ProjectChatSend {
    /// The agent and model it went with, back in the picker when it's taken back to edit
    /// (the text loses its mention); nil for a note.
    var sentWith: ResumeSettings? {
        let to = to ?? agentMention(body) ?? "message"
        guard to != "message" else { return nil }
        return ResumeSettings(
            provider: to, choice: choice, contextWindow: contextWindow, runtimeMode: runtimeMode,
            interactionMode: interactionMode)
    }
}

/// `pastedImageSchema`: a photo sent along with a message.
public struct PastedImage: Codable, Sendable, Equatable, Hashable {
    public var name: String
    /// "image/png" | "image/jpeg" | "image/webp"
    public var mimeType: String
    /// `data:<mimeType>;base64,…`, at most `PastedImage.maxDataURL` characters.
    public var dataUrl: String

    public static let maxDataURL = 1_100_000
    public static let maxPerMessage = 3

    public init(name: String, mimeType: String, data: Data) {
        self.name = name
        self.mimeType = mimeType
        dataUrl = "data:\(mimeType);base64,\(data.base64EncodedString())"
    }
}

/// Who answers a text: the agent it starts with a mention of, else the one picked (`draftRecipient`).
public func sendRecipient(_ text: String, picked: String) -> String {
    agentMention(text.trimmingCharacters(in: .whitespacesAndNewlines)) ?? picked
}

/// The agent a text starts with a mention of: "@claude fix it" → "claude".
func agentMention(_ text: String) -> String? {
    guard text.first == "@" else { return nil }
    let name = text.dropFirst().prefix { !$0.isWhitespace }.lowercased()
    return builtinAgents.contains(name) ? name : nil
}

/// The text as the user wrote it, without the agent mention every composer puts first.
public func withoutAgentMention(_ text: String) -> String {
    guard agentMention(text) != nil else { return text }
    return String(text.drop { !$0.isWhitespace }.drop { $0.isWhitespace })
}

public extension RemoteClient {
    /// `desktop("sendProjectChat", [chatId, send])`, with `to` dropped for desktops before `Bridge.recipient`.
    func sendProjectChat(chatId: String, _ send: ProjectChatSend) async throws {
        _ = try await desktop("sendProjectChat", [.string(chatId), try JSON(encoding: send)])
    }

    /// Stops the running answer.
    func cancelProjectChat(chatId: String) async throws {
        _ = try await desktop("cancelProjectChat", [.string(chatId)])
    }
}
