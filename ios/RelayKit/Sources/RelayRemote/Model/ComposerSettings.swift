import Foundation

/// A conversation's own model, including threads mirrored through another computer.
public func threadComposerSettings(_ thread: RemoteChat, rootId: String? = nil) -> ResumeSettings? {
    let conversation = rootId.map { sideConversation(thread.messages, root: $0) } ?? mainMessages(thread.messages)
    let latest = conversation.last { message in
        message.role == "user" && message.sentSettings != nil
            && (rootId != nil || message.side != true)
            && (message.id != rootId || message.side == true)
    }
    if let settings = latest?.sentSettings { return settings }
    guard let legacy = thread.settings else { return nil }
    return conversationSettings(
        legacy, lastParentId: thread.lastParentId, rootId: rootId,
        holder: contextAgent(conversation, rootId: rootId))
}
