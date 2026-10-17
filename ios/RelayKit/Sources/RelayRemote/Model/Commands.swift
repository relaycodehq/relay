import Foundation

// shared/commands.ts and shared/composer-commands.ts; the Android app's
// composer/logic Commands.kt and the menu's items from CommandList.kt.

public struct RelayCommandInfo: Sendable, Equatable {
    public let name: String
    public let description: String
    public let args: String?

    init(_ name: String, _ description: String, _ args: String? = nil) {
        self.name = name
        self.description = description
        self.args = args
    }
}

public let relayCommands = [
    RelayCommandInfo("openpr", "Open this branch’s PR, or create one"),
    RelayCommandInfo("changes", "Review local uncommitted changes"),
    RelayCommandInfo("files", "Browse project files"),
    RelayCommandInfo("new", "Start a new thread in this project"),
    RelayCommandInfo("clear", "Start a new thread with empty context"),
    RelayCommandInfo("compact", "Summarize earlier turns to free context", "[instructions]"),
    RelayCommandInfo("context", "Show context window usage"),
    RelayCommandInfo("goal", "Keep the agent working until a goal is met", "<objective|pause|resume|clear>"),
    RelayCommandInfo("reload", "Restart the agent on this conversation to load new skills, plugins and instructions"),
    RelayCommandInfo("btw", "Ask a side question without interrupting the agent", "<question>"),
    RelayCommandInfo(
        "provider", "Switch between \(agentProviders.map(agentName).joined(separator: ", ")) and messages only",
        "<agent>"),
    RelayCommandInfo("model", "Choose the model", "<model>"),
    RelayCommandInfo("effort", "Set reasoning effort", "<level>"),
    RelayCommandInfo("plan", "Toggle plan mode", "[on|off]"),
    RelayCommandInfo("permissions", "Set what the agent may do without asking", "<mode>"),
    RelayCommandInfo("fast", "Toggle Fast mode", "[on|off]"),
    RelayCommandInfo("add-dir", "Let the agent reach another folder in this thread", "<folder>"),
    RelayCommandInfo("resume", "Continue a Claude Code or Codex session from a terminal", "<session>"),
]

let composerCommands: Set = ["provider", "model", "effort", "plan", "permissions", "fast"]

public func isComposerCommand(_ name: String) -> Bool { composerCommands.contains(name) }

let sideAgentsText: String = {
    let names = sideProviders.map(agentName)
    return names.dropLast().joined(separator: ", ") + " or " + (names.last ?? "")
}()

/// Why `provider` can't take a `/btw`, or nil when it can.
public func sideRefusal(_ provider: String) -> String? {
    agentTraits(provider)?.side == true
        ? nil : "\(agentName(provider)) can't answer beside the thread. Pick \(sideAgentsText) to ask a side question."
}

public struct ParsedCommand: Equatable, Sendable {
    public let name: String
    public let args: String
}

private let commandPattern = try! NSRegularExpression(
    pattern: "^/([a-z]+(?:-[a-z]+)*)(?:\\s+([\\s\\S]*))?$", options: .caseInsensitive)

/// Relay commands take arguments only where they declare them.
public func relayCommand(_ text: String) -> ParsedCommand? {
    let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
    let ns = trimmed as NSString
    guard let m = commandPattern.firstMatch(in: trimmed, range: NSRange(location: 0, length: ns.length)) else {
        return nil
    }
    let name = ns.substring(with: m.range(at: 1)).lowercased()
    guard let command = relayCommands.first(where: { $0.name == name }) else { return nil }
    let args = m.range(at: 2).location == NSNotFound
        ? "" : ns.substring(with: m.range(at: 2)).trimmingCharacters(in: .whitespacesAndNewlines)
    if !args.isEmpty && command.args == nil { return nil }
    return ParsedCommand(name: command.name, args: args)
}

/// A leading `/` names a command, unless it opens a path like `/Users/me/clip.mp4`.
public func startsWithCommand(_ text: String) -> Bool {
    text.trimmingCharacters(in: .whitespacesAndNewlines).range(of: "^/[^\\s/]*(?:\\s|$)", options: .regularExpression)
        != nil
}

public struct CommandTrigger: Equatable, Sendable {
    public let prefix: Character
    public let query: String
    /// Mid-sentence: only composer commands and skills go there.
    public let inline: Bool
}

private let triggerPattern = try! NSRegularExpression(pattern: "(^|\\s)([$/])(\\S*)$")

/// Slash actions start a message, composer commands may follow text, `$skill` goes anywhere.
public func commandTrigger(_ text: String) -> CommandTrigger? {
    let ns = text as NSString
    guard let m = triggerPattern.firstMatch(in: text, range: NSRange(location: 0, length: ns.length)) else {
        return nil
    }
    let prefix = Character(ns.substring(with: m.range(at: 2)))
    let query = ns.substring(with: m.range(at: 3))
    if prefix == "/" && query.contains("/") { return nil }
    let start = m.range.location + m.range(at: 1).length
    let before = ns.substring(to: start)
    return CommandTrigger(
        prefix: prefix, query: query,
        inline: prefix == "/" && !before.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
}

/// A command an agent offers (skills, prompts), as the desktop lists it.
public struct ProviderCommand: Codable, Sendable, Equatable {
    public var name: String
    public var description: String
    public var displayName: String?
    public var source: String?
    public var argumentHint: String?
    public var skill: Bool?

    public init(name: String, description: String = "", displayName: String? = nil, source: String? = nil) {
        self.name = name
        self.description = description
        self.displayName = displayName
        self.source = source
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        name = try c.decode(String.self, forKey: .name)
        description = try c.decodeIfPresent(String.self, forKey: .description) ?? ""
        displayName = try c.decodeIfPresent(String.self, forKey: .displayName)
        source = try c.decodeIfPresent(String.self, forKey: .source)
        argumentHint = try c.decodeIfPresent(String.self, forKey: .argumentHint)
        skill = try c.decodeIfPresent(Bool.self, forKey: .skill)
    }
}

// MARK: The menu

/// One line of the slash menu.
public struct CommandMenuItem: Identifiable, Equatable, Sendable {
    public enum Kind: String, Sendable { case relay, command, skill }
    public let kind: Kind
    public let name: String
    public let label: String
    public let description: String
    public var args: String?
    /// Who offers it: "Relay", the agent, or the skill's origin.
    public var source: String
    public var id: String { "\(kind.rawValue):\(name)" }
}

private let skillSources = [
    "app": "App", "repo": "Repo", "project": "Project", "personal": "Personal", "system": "System",
    "claude": "Claude", "other": "Provider",
]

/// What the menu offers for the text being typed, or nil when it's closed. `hidden` are
/// Relay's actions this phone can't do yet.
public func commandItems(_ text: String, provider: String, commands: [ProviderCommand], hidden: Set<String> = [])
    -> [CommandMenuItem]?
{
    // Relay's actions start a message; a slash mid-sentence is just text.
    guard let trigger = commandTrigger(text), !trigger.inline else { return nil }
    let query = trigger.query.lowercased()
    let traits = agentTraits(provider)
    let alone = traits?.commandsAlone == true
    let slash = trigger.prefix == "/"
    var items: [CommandMenuItem] = []
    if slash {
        for c in relayCommands where !hidden.contains(c.name) && (c.name != "btw" || traits?.side == true) {
            items.append(
                CommandMenuItem(
                    kind: .relay, name: c.name, label: "/" + c.name + (c.args.map { " \($0)" } ?? ""),
                    description: c.description, args: c.args, source: "Relay"))
        }
    }
    if slash || !alone {
        for c in commands {
            if alone {
                items.append(
                    CommandMenuItem(
                        kind: .command, name: c.name, label: "/" + c.name + (c.argumentHint.map { " \($0)" } ?? ""),
                        description: c.description, source: agentName(provider)))
            } else {
                let bare = c.name.hasPrefix("skill:") ? String(c.name.dropFirst(6)) : c.name
                let shown = c.displayName.flatMap { $0.isEmpty ? nil : $0 } ?? bare
                items.append(
                    CommandMenuItem(
                        kind: .skill, name: bare, label: (slash ? "/skill:" : "$") + shown, description: c.description,
                        source: "\(skillSources[c.source ?? "other"] ?? "Provider") skill"))
            }
        }
    }
    // Swift's `contains("")` is false, where Kotlin's is true.
    let matching = query.isEmpty ? items : items.filter { "\($0.name) \($0.label)".lowercased().contains(query) }
    return Array(matching.prefix(60))
}

/// A picked skill goes in where it was typed, as `$name`.
public func withSkill(_ text: String, _ name: String) -> String {
    text.replacingOccurrences(of: "(^|\\s)[$/][^\\s]*$", with: "$1\\$\(name) ", options: .regularExpression)
}

// MARK: Composer commands

/// What a composer command changes.
public enum ComposerChange: Equatable, Sendable {
    case provider(String)
    /// The model goes to the provider, which becomes the recipient; "" is Default.
    case model(provider: String, model: String)
    case effort(String)
    case permissions(String)
    case plan(Bool)
    case fast(Bool)
}

public struct ModelOption: Equatable, Sendable {
    public let provider: String
    public let value: String
    public let description: String
}

/// Every model /model can switch to: the recipient's, its Default, then the rest.
public func modelCommandOptions(_ recipient: String, _ catalogs: ModelCatalogs, defaultNames: [String: String] = [:])
    -> [ModelOption]
{
    let listed = agentProviders.flatMap { provider -> [ModelOption] in
        let models = catalogs[provider] ?? []
        return models.flatMap { m -> [ModelOption] in
            let long = withClaudeContextWindow(m.id, "1m")
            var options = [ModelOption(provider: provider, value: m.id, description: m.name)]
            if m.longContext == true && !models.contains(where: { $0.id == long }) {
                options.append(ModelOption(provider: provider, value: long, description: "\(m.name) · 1M context"))
            }
            return options
        }
    }
    let byDefault =
        recipient == "message"
        ? []
        : [
            ModelOption(
                provider: recipient, value: "default",
                description: defaultNames[recipient].map { "\(agentName(recipient)) default · \($0)" }
                    ?? "\(agentName(recipient)) default")
        ]
    return listed.filter { $0.provider == recipient } + byDefault + listed.filter { $0.provider != recipient }
}

public struct CommandSettings: Sendable {
    public var recipient: String
    /// What /provider may switch to.
    public var targets: [String]
    /// The recipient's model; "" is its Default.
    public var model: String
    public var fast: Bool
    public var plan: Bool
    public var catalogs: ModelCatalogs
    public var defaultNames: [String: String] = [:]

    public init(
        recipient: String, targets: [String] = agentProviders, model: String, fast: Bool, plan: Bool,
        catalogs: ModelCatalogs
    ) {
        self.recipient = recipient
        self.targets = targets
        self.model = model
        self.fast = fast
        self.plan = plan
        self.catalogs = catalogs
    }
}

public enum CommandResult: Equatable, Sendable {
    case change(ComposerChange)
    case error(String)
}

private let modelSchema = "^[a-zA-Z0-9][a-zA-Z0-9._:/\\[\\]@~+-]*$"
private let noAgent = "Choose an agent before changing agent settings."

/// A composer command's change to `settings`, or why it can't make one.
public func composerCommand(_ command: String, _ args: String, _ settings: CommandSettings) -> CommandResult {
    let value = args.lowercased()
    let recipient = settings.recipient
    if command == "provider" {
        guard let provider = settings.targets.first(where: { $0 == value }) else {
            return .error("Choose one of: \(settings.targets.joined(separator: ", ")).")
        }
        return .change(.provider(provider))
    }
    if command == "model" {
        let option = modelCommandOptions(recipient, settings.catalogs, defaultNames: settings.defaultNames)
            .first { $0.value.lowercased() == value || $0.description.lowercased() == value }
        let model: String? =
            if let option { option.value == "default" ? "" : option.value }
            else if args.count <= 160 && args.range(of: modelSchema, options: .regularExpression) != nil { args }
            else { nil }
        let provider = option?.provider ?? recipient
        guard let model else { return .error("Enter a valid model ID.") }
        if provider == "message" { return .error(noAgent) }
        return .change(.model(provider: provider, model: model))
    }
    if recipient == "message" { return .error(noAgent) }
    if !args.isEmpty && (command == "plan" || command == "fast") && value != "on" && value != "off" {
        return .error("Use /\(command) on or /\(command) off.")
    }
    func toggled(_ on: Bool) -> Bool { value == "on" ? true : value == "off" ? false : !on }
    switch command {
    case "effort":
        let allowed = ["default"] + modelEfforts(recipient, model: settings.model, settings.catalogs[recipient])
        guard allowed.contains(value) else { return .error("Choose one of: \(allowed.joined(separator: ", ")).") }
        return .change(.effort(value == "default" ? "" : value))
    case "permissions":
        guard let mode = runtimeModes.first(where: { $0.value == value || $0.label.lowercased() == value }) else {
            return .error("Choose one of: \(runtimeModes.map(\.value).joined(separator: ", ")).")
        }
        return .change(.permissions(mode.value))
    case "plan":
        return .change(.plan(toggled(settings.plan)))
    default:
        break
    }
    let fast = toggled(settings.fast)
    if !supportsFast(recipient, model: settings.model, settings.catalogs[recipient]) && !(recipient == "cursor" && !fast)
    {
        return .error(
            recipient == "cursor"
                ? "Fast mode is not available for this Cursor model."
                : "Fast mode is only available for Codex and supported Cursor models.")
    }
    return .change(.fast(fast))
}

public extension ResumeSettings {
    /// The settings after a composer command; `switchTo` moves to another agent the composer's way.
    func with(
        _ change: ComposerChange, _ catalogs: ModelCatalogs,
        switchTo: (ResumeSettings, String) -> ResumeSettings = { $0.onAgent($1) }
    ) -> ResumeSettings {
        var next = self
        switch change {
        case .provider(let provider):
            return switchTo(self, provider)
        case .model(let provider, let model):
            return switchTo(self, provider).onModel(model, catalogs[provider])
        case .effort(let effort):
            next.choice.reasoningEffort = effort
        case .permissions(let mode):
            next.runtimeMode = mode
        case .plan(let plan):
            next.interactionMode = plan ? "plan" : "default"
        case .fast(let fast):
            next.choice.fast = fast
        }
        return next
    }
}

public extension RemoteClient {
    /// The agent's own commands and skills for a project.
    func projectCommands(projectId: String, provider: String) async throws -> [ProviderCommand] {
        try await desktop("projectCommands", [.string(projectId), .string(provider)]).decode()
    }

    /// Restarts the agent on the conversation, to load new skills, plugins and instructions.
    func reloadSession(chatId: String) async throws {
        _ = try await desktop("reloadProjectChatSession", [.string(chatId)])
    }
}
