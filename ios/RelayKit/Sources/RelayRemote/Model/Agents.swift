import Foundation

// shared/agents.ts, settings.ts and model-fit.ts, as far as a composer needs
// them; the Android app's composer/logic Agents.kt and Models.kt.

/// The built-in agents in the desktop's order.
public let agentProviders = ["codex", "claude", "opencode", "cursor", "muse", "amp", "antigravity"]

let builtinAgents = Set(agentProviders)

/// shared/agent-prefs.ts: what a picker offers, in Settings' order (the ones it
/// hasn't placed after, in Relay's), without those switched off except `keep`.
public func offeredAgents(order: [String], off: [String], keep: String? = nil) -> [String] {
    var placed: [String] = []
    for provider in order where builtinAgents.contains(provider) && !placed.contains(provider) {
        placed.append(provider)
    }
    return (placed + agentProviders.filter { !placed.contains($0) }).filter { !off.contains($0) || $0 == keep }
}

private let agentNames = [
    "codex": "Codex", "claude": "Claude", "opencode": "OpenCode", "cursor": "Cursor", "muse": "Muse",
    "amp": "Amp", "antigravity": "Antigravity",
]

/// A built-in agent, or a registry one: `acp:` and a lowercase id.
public func isAgentProvider(_ value: String?) -> Bool {
    guard let value else { return false }
    if builtinAgents.contains(value) { return true }
    guard value.hasPrefix("acp:") else { return false }
    let id = value.dropFirst(4)
    guard let first = id.first, first.isLowercase || first.isNumber else { return false }
    return id.allSatisfy { ($0.isASCII && ($0.isLowercase || $0.isNumber)) || $0 == "-" }
}

/// What an agent offers, as far as the composer needs it (shared/agents.ts).
public struct AgentTraits: Sendable, Equatable {
    public var fast = false
    /// `$skill` anywhere in a message.
    public var skills = false
    /// Its own commands stand alone as `/name`, rather than as skills.
    public var commandsAlone = true
    /// Answers `/btw` beside the thread.
    public var side = false
    /// Reports its plan's limits.
    public var usage = false
}

private let traits: [String: AgentTraits] = [
    "codex": AgentTraits(fast: true, skills: true, commandsAlone: false, side: true, usage: true),
    "claude": AgentTraits(side: true, usage: true),
    "opencode": AgentTraits(side: true),
    "cursor": AgentTraits(fast: true),
    "muse": AgentTraits(side: true, usage: true),
    "amp": AgentTraits(),
    "antigravity": AgentTraits(),
]

/// A registry agent has none of the extras.
public func agentTraits(_ provider: String) -> AgentTraits? {
    traits[provider] ?? (isAgentProvider(provider) ? AgentTraits() : nil)
}

/// The agents that answer `/btw`.
public let sideProviders = agentProviders.filter { traits[$0]?.side == true }

/// `agentInfo[provider].name`; a registry agent whose name hasn't arrived
/// goes by its id: "acp:factory-droid" → "Factory Droid".
public func agentName(_ provider: String) -> String {
    if let name = agentNames[provider] { return name }
    guard isAgentProvider(provider) else { return provider }
    return provider.dropFirst(4).split(separator: "-").map { $0.prefix(1).uppercased() + $0.dropFirst() }
        .joined(separator: " ")
}

/// A model an agent offers, as its CLI or server lists it.
public struct AgentModel: Codable, Sendable, Equatable, Identifiable {
    public var id: String
    public var name: String
    public var description: String
    public var efforts: [String]
    public var fast: Bool?
    public var legacy: Bool?
    public var defaultEffort: String?
    public var group: String?
    public var contextWindow: Int64?
    /// What an alias stands for.
    public var resolved: String?
    /// Claude's: also runs with a 1M window.
    public var longContext: Bool?

    public init(
        id: String, name: String, description: String = "", efforts: [String] = [], legacy: Bool? = nil,
        longContext: Bool? = nil
    ) {
        self.id = id
        self.name = name
        self.description = description
        self.efforts = efforts
        self.legacy = legacy
        self.longContext = longContext
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        name = try c.decodeIfPresent(String.self, forKey: .name) ?? id
        description = try c.decodeIfPresent(String.self, forKey: .description) ?? ""
        efforts = try c.decodeIfPresent([String].self, forKey: .efforts) ?? []
        fast = try c.decodeIfPresent(Bool.self, forKey: .fast)
        legacy = try c.decodeIfPresent(Bool.self, forKey: .legacy)
        defaultEffort = try c.decodeIfPresent(String.self, forKey: .defaultEffort)
        group = try c.decodeIfPresent(String.self, forKey: .group)
        contextWindow = try c.decodeIfPresent(Int64.self, forKey: .contextWindow)
        resolved = try c.decodeIfPresent(String.self, forKey: .resolved)
        longContext = try c.decodeIfPresent(Bool.self, forKey: .longContext)
    }
}

/// What an agent runs where a thread leaves the model or effort on Default.
public struct AgentDefaults: Codable, Sendable, Equatable {
    public var model: String
    public var effort: String
    /// Each model's default effort, by id.
    public var efforts: [String: String]?

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        model = try c.decodeIfPresent(String.self, forKey: .model) ?? ""
        effort = try c.decodeIfPresent(String.self, forKey: .effort) ?? ""
        efforts = try c.decodeIfPresent([String: String].self, forKey: .efforts)
    }
}

/// Model lists by agent.
public typealias ModelCatalogs = [String: [AgentModel]]

// MARK: Efforts

public let reasoningEfforts = ["", "none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"]

private let effortLabels = [
    "none": "None", "minimal": "Minimal", "low": "Low", "medium": "Medium", "high": "High", "xhigh": "Extra high",
    "max": "Max", "ultra": "Ultra",
]

/// "" is "Default".
public func effortLabel(_ effort: String) -> String {
    effort.isEmpty ? "Default" : effortLabels[effort] ?? effort
}

private let common = ["low", "medium", "high", "xhigh"]

/// Offered until Codex lists its models, and whenever it can't.
public let fallbackCodexModels = [
    AgentModel(id: "gpt-6-astra", name: "GPT-6-Astra", efforts: common + ["max", "ultra"], legacy: false),
    AgentModel(id: "gpt-6-sol", name: "GPT-6-Sol", efforts: common + ["max", "ultra"], legacy: false),
    AgentModel(id: "gpt-6-luna", name: "GPT-6-Luna", efforts: common + ["max"], legacy: false),
    AgentModel(id: "gpt-5.6-sol", name: "GPT-5.6-Sol", efforts: common + ["max", "ultra"], legacy: false),
    AgentModel(id: "gpt-5.6-terra", name: "GPT-5.6-Terra", efforts: common + ["max", "ultra"], legacy: false),
    AgentModel(id: "gpt-5.6-luna", name: "GPT-5.6-Luna", efforts: common + ["max"], legacy: false),
    AgentModel(id: "gpt-5.5", name: "GPT-5.5", efforts: common, legacy: true),
]

/// A model Codex didn't list (custom, or the list failed) offers every level.
func codexEfforts(_ model: String, _ listed: [AgentModel]?) -> [String] {
    ((listed ?? fallbackCodexModels).first { $0.id == model } ?? fallbackCodexModels.first { $0.id == model })?.efforts
        ?? reasoningEfforts.filter { !$0.isEmpty }
}

let claudeEfforts = ["low", "medium", "high", "xhigh", "max"]

// MARK: Claude's window

func claudeContextWindow(_ model: String) -> String { model.hasSuffix("[1m]") ? "1m" : "200k" }

func withClaudeContextWindow(_ model: String, _ window: String) -> String {
    (model.hasSuffix("[1m]") ? String(model.dropLast(4)) : model) + (window == "1m" ? "[1m]" : "")
}

/// The listed model an id refers to, whichever context window it asks for.
func findClaudeModel(_ models: [AgentModel]?, _ id: String) -> AgentModel? {
    guard let models, !id.isEmpty else { return nil }
    let bare = withClaudeContextWindow(id, "200k")
    if let exact = models.first(where: { $0.id == id }) { return exact }
    if let same = models.first(where: { withClaudeContextWindow($0.id, "200k") == bare }) { return same }
    let aliases = models.filter { $0.resolved.map { withClaudeContextWindow($0, "200k") } == bare }
    return aliases.first { claudeContextWindow($0.id) == claudeContextWindow(id) } ?? aliases.first
}

// MARK: Fitting a choice to its agent

/// Fast stays on only for agents that have it.
public func fastFor(_ provider: String, _ fast: Bool) -> Bool {
    fast && (provider == "codex" || provider == "cursor")
}

public func supportsFast(_ provider: String, model: String, _ models: [AgentModel]?) -> Bool {
    provider == "codex"
        || (provider == "cursor" && models?.first { $0.id == (model.isEmpty ? "auto" : model) }?.fast == true)
}

/// The 200k window is Claude's, and a model with 1M built in asks for none.
public func windowFor(_ provider: String, model: String, _ contextWindow: String?) -> String? {
    guard provider == "claude", let contextWindow, !contextWindow.isEmpty, claudeContextWindow(model) != "1m"
    else { return nil }
    return contextWindow
}

public func listedModel(_ provider: String, _ models: [AgentModel]?, _ id: String) -> AgentModel? {
    provider == "claude" ? findClaudeModel(models, id) : models?.first { $0.id == id }
}

/// The efforts an agent's model takes.
public func modelEfforts(_ provider: String, model: String, _ models: [AgentModel]?) -> [String] {
    switch provider {
    case "codex": codexEfforts(model, models)
    case "claude": findClaudeModel(models, model)?.efforts ?? claudeEfforts
    default: models?.first { $0.id == model }?.efforts ?? []
    }
}

/// `choice` moved to `model`, which takes `efforts`: one it lacks goes back to Default.
func onModel(_ provider: String, _ choice: ModelChoice, model: String, efforts: [String], _ models: [AgentModel]?)
    -> ModelChoice
{
    ModelChoice(
        model: model,
        fast: fastFor(provider, choice.fast)
            && (provider != "cursor" || (models == nil && !model.isEmpty) || supportsFast(provider, model: model, models)),
        reasoningEffort: efforts.contains(choice.reasoningEffort) ? choice.reasoningEffort : "")
}

public let byDefault = ModelChoice(model: "")

public extension ResumeSettings {
    /// The same composer on another agent: its model goes back to Default.
    func onAgent(_ provider: String) -> ResumeSettings {
        guard provider != self.provider else { return self }
        var next = self
        next.provider = provider
        next.choice = byDefault
        next.contextWindow = nil
        return next
    }

    /// On `model` of the agent's list, keeping the effort only where it fits.
    func onModel(_ model: String, _ models: [AgentModel]?) -> ResumeSettings {
        var next = self
        next.choice = RelayRemote.onModel(
            provider, choice, model: model, efforts: modelEfforts(provider, model: model, models), models)
        next.contextWindow = windowFor(provider, model: model, contextWindow)
        return next
    }

    /// Claude on the 200k window, or back on its default (1M on most models).
    func onWindow(_ size: String) -> ResumeSettings {
        var next = self
        if size == "200k" {
            next.choice.model = withClaudeContextWindow(choice.model, "200k")
            next.contextWindow = "200k"
        } else {
            next.choice.model = choice.model.isEmpty ? "" : withClaudeContextWindow(choice.model, "1m")
            next.contextWindow = nil
        }
        return next
    }

    /// "Claude · Opus 5.5 · High"; the model's name when the list has it.
    func label(_ models: [AgentModel]?) -> String {
        ([agentName(provider)] + modelParts(models)).joined(separator: " · ")
    }

    /// "Opus 5.5 · High", the label without the agent's name.
    func modelLabel(_ models: [AgentModel]?) -> String {
        modelParts(models).joined(separator: " · ")
    }

    private func modelParts(_ models: [AgentModel]?) -> [String] {
        var parts: [String] = []
        if !choice.model.isEmpty { parts.append(listedModel(provider, models, choice.model)?.name ?? choice.model) }
        if !choice.reasoningEffort.isEmpty { parts.append(effortLabel(choice.reasoningEffort)) }
        if fastFor(provider, choice.fast) { parts.append("Fast") }
        if windowFor(provider, model: choice.model, contextWindow) != nil { parts.append("200k") }
        return parts
    }
}
