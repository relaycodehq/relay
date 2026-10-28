import Foundation

// Typed bridge calls (RemoteApi in shared/remote.ts). Each throws what
// `RemoteClient.call` does; ones a desktop may lack say from which bridge.

public extension RemoteClient {
    func overview() async throws -> RemoteOverview {
        try await call("overview").decode()
    }

    /// The thread with its latest messages, those `previous` holds at the same version reused.
    /// Finished turns but the newest come folded, their steps fetched when one opens; older
    /// desktops ignore the ask and send them all.
    func chat(_ id: String, previous: RemoteChat? = nil, history: Int? = nil, sendId: String? = nil) async throws
        -> RemoteChat
    {
        let known = try knownOf(previous).map { try JSON(encoding: $0) }
        var args: [JSON?] = [
            .string(id), known, history.map { .number(Double($0)) }, sendId.map(JSON.string), .string("latest"),
        ]
        while let last = args.last, last == nil { args.removeLast() }
        let patch = try await call("chat", args)
        guard let object = patch.object else { throw RemoteCallError.rejected("A thread that isn't one.") }
        return try applyChatPatch(object, previous: previous)
    }

    /// Icons that differ from the phone's `known` hashes (nil for "none"), by project id.
    func projectIcons(known: [String: String?]) async throws -> [String: RemoteProjectIcon] {
        let map = JSON.object(known.mapValues { $0.map(JSON.string) ?? .null })
        return try await call("projectIcons", [map]).decode()
    }

    /// A folded turn's steps; nil once the message is gone. From `Bridge.stepsOnOpen`.
    func messageSteps(chatId: String, messageId: String) async throws -> MessageSteps? {
        let steps = try await call("messageSteps", [.string(chatId), .string(messageId)])
        return steps.isNull ? nil : try steps.decode()
    }

    /// A tool call's whole output. From `Bridge.activityDetail`.
    func activityDetail(chatId: String, messageId: String, activityId: String) async throws -> String? {
        try await call("activityDetail", [.string(chatId), .string(messageId), .string(activityId)]).string
    }

    /// The code a call wrote, per file; nil when it wrote none. From `Bridge.traceTree`.
    func activityWritten(chatId: String, messageId: String, activityId: String) async throws -> [WrittenCode]? {
        let written = try await call("activityWritten", [.string(chatId), .string(messageId), .string(activityId)])
        return written.isNull ? nil : try written.decode()
    }

    /// From `Bridge.phoneUpdates`.
    func computerInfo() async throws -> ComputerInfo {
        try await call("computerInfo").decode()
    }

    /// Projects' tasks listening on a port, one per port. From `Bridge.tunnel`.
    func sites() async throws -> [RemoteSite] {
        try await call("sites").decode()
    }

    /// Lets the tunnel reach a port typed into the address bar, besides Sites'. From `Bridge.tunnel`.
    func tunnelAllow(port: Int) async throws {
        _ = try await call("tunnelAllow", [.number(Double(port))])
    }

    /// Appends base64 `data` at `offset` of file `id`; how much of it the computer has after. From `Bridge.files`.
    func uploadFile(id: String, name: String, size: Int64, offset: Int64, data: String) async throws -> UploadedFile {
        try await call(
            "uploadFile", [.string(id), .string(name), .number(Double(size)), .number(Double(offset)), .string(data)]
        ).decode()
    }

    /// `desktop("markProjectChatSeen", [chatId, at])`.
    func markSeen(chatId: String, at: Int64) async throws {
        _ = try await desktop("markProjectChatSeen", [.string(chatId), .number(Double(at))])
    }
}
