import Foundation

/// A dev server the phone can open through the tunnel: a project's task listening on `port`.
public struct RemoteSite: Codable, Sendable, Equatable, Identifiable {
    public var port: Int
    /// What it is, e.g. "Vite dev server".
    public var title: String
    public var command: String
    public var projectId: String
    public var project: String
    /// The thread whose agent or terminal started it.
    public var chatId: String?
    /// Runs in a thread's worktree rather than the project's checkout.
    public var worktree: Bool

    public var id: Int { port }

    public init(
        port: Int, title: String, command: String, projectId: String, project: String, chatId: String? = nil,
        worktree: Bool = false
    ) {
        self.port = port
        self.title = title
        self.command = command
        self.projectId = projectId
        self.project = project
        self.chatId = chatId
        self.worktree = worktree
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        port = try c.decode(Int.self, forKey: .port)
        title = try c.decode(String.self, forKey: .title)
        command = try c.decode(String.self, forKey: .command)
        projectId = try c.decode(String.self, forKey: .projectId)
        project = try c.decode(String.self, forKey: .project)
        chatId = try c.decodeIfPresent(String.self, forKey: .chatId)
        worktree = try c.decodeIfPresent(Bool.self, forKey: .worktree) ?? false
    }
}
