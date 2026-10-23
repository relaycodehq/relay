import Foundation

// shared/remote-compose.ts and new-thread-models.ts: a new thread opens on
// the agent picked last and the model that agent last ran with.

/// A model choice and its window, as a new thread remembers it per agent.
public struct NewThreadModel: Codable, Sendable, Equatable {
    public var choice: ModelChoice
    public var contextWindow: String?

    public init(choice: ModelChoice, contextWindow: String? = nil) {
        self.choice = choice
        self.contextWindow = contextWindow
    }

    public init(_ settings: ResumeSettings) {
        self.init(choice: settings.choice, contextWindow: settings.contextWindow)
    }
}

public typealias NewThreadModels = [String: NewThreadModel]

/// The parts of the desktop's AI settings a new thread opens on.
public struct NewThreadAI: Codable, Sendable, Equatable {
    public var threadProvider: String?
    public var questionsProvider: String?
    public var questions: ModelChoice?
    /// The agents as Settings → Agents lists them; older desktops leave both out.
    public var agentOrder: [String]? = nil
    public var agentsOff: [String]? = nil
}

private func known(_ provider: String?) -> String? { isAgentProvider(provider) ? provider : nil }

/// A new thread's composer as the desktop starts one: the access it remembers
/// (else Auto-accept edits), Build, the agent picked last (else the default
/// one) on its remembered model.
public func newThreadSettings(
    last: String?, ai: NewThreadAI?, models: NewThreadModels, runtimeMode: String? = nil
) -> ResumeSettings {
    // The agent picked last, unless it's been switched off since.
    let lastOn = known(last).flatMap { ai?.agentsOff?.contains($0) == true ? nil : $0 }
    let provider = lastOn ?? known(ai?.threadProvider) ?? "codex"
    // Codex picked for questions too starts on that model.
    let codex = provider == "codex" && ai?.questionsProvider == "codex" ? ai?.questions : nil
    return ResumeSettings(
        provider: provider, choice: codex ?? byDefault, contextWindow: nil,
        runtimeMode: runtimeModes.first { $0.value == runtimeMode }?.value ?? defaultRuntimeMode,
        interactionMode: "default"
    ).remembering(models)
}

public extension ResumeSettings {
    /// On the model its agent last ran with, when there is one; a blank pick is the Default.
    func remembering(_ models: NewThreadModels) -> ResumeSettings {
        guard let remembered = models[provider] else { return self }
        let c = remembered.choice
        if c.model.isEmpty && c.reasoningEffort.isEmpty && !c.fast { return self }
        var next = self
        next.choice = c
        next.contextWindow = remembered.contextWindow.flatMap { $0.isEmpty ? nil : $0 }
        return next
    }
}

/// What `createProjectChat` answers with, as far as the phone reads it.
public struct CreatedChat: Codable, Sendable, Equatable {
    public var id: String
    public var title: String?
}

public extension RemoteClient {
    func agentModels(_ provider: String) async throws -> [AgentModel] {
        try await desktop("agentModels", [.string(provider)]).decode()
    }

    /// Project-specific; nil where the agent doesn't say.
    func agentDefaults(projectId: String, provider: String) async throws -> AgentDefaults? {
        let answer = try await desktop("agentDefaults", [.string(projectId), .string(provider)])
        return answer.isNull ? nil : try answer.decode()
    }

    func aiSettings() async throws -> NewThreadAI {
        try await desktop("aiSettings").decode()
    }

    func saveNewThreadAgent(_ provider: String) async throws {
        _ = try await desktop("saveNewThreadAgent", [.string(provider)])
    }

    func saveNewThreadModel(_ provider: String, _ model: NewThreadModel) async throws {
        _ = try await desktop("saveNewThreadModel", [.string(provider), try JSON(encoding: model)])
    }

    /// From `Bridge.readOnlyMode`.
    func saveNewThreadRuntimeMode(_ mode: String) async throws {
        _ = try await desktop("saveNewThreadRuntimeMode", [.string(mode)])
    }

    /// A thread in the project; `workspace` "checkout" | "worktree", left out for plain folders.
    func createProjectChat(projectId: String, workspace: String?) async throws -> CreatedChat {
        try await desktop(
            "createProjectChat", [.string(projectId), .object(["kind": .string("project")]), workspace.map(JSON.string)]
        ).decode()
    }

    /// A new thread's composer as the desktop would start it, and the models
    /// it remembers per agent; each lookup may fail on its own.
    func newThreadDefaults() async -> (settings: ResumeSettings, models: NewThreadModels) {
        async let last = try? desktop("newThreadAgent").string
        async let ai = try? desktop("aiSettings").decode(NewThreadAI.self)
        async let models = try? desktop("newThreadModels").decode(NewThreadModels.self)
        // Older desktops don't know the call; the default stands.
        async let mode = try? desktop("newThreadRuntimeMode").string
        let remembered = await models ?? [:]
        return (
            newThreadSettings(last: await last, ai: await ai, models: remembered, runtimeMode: await mode),
            remembered
        )
    }
}
