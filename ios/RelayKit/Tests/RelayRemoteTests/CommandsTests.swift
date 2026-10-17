import Testing

@testable import RelayRemote

// The Android app's QuotesAndCommandsTest, for the commands.
struct CommandsTests {
    let catalogs: ModelCatalogs = [
        "codex": [AgentModel(id: "gpt-6-luna", name: "GPT-6-Luna", efforts: ["low", "medium", "high"])],
        "claude": [AgentModel(id: "opus", name: "Opus", efforts: ["low", "high", "max"], longContext: true)],
        "opencode": [AgentModel(id: "anthropic/sonnet", name: "Sonnet", efforts: ["high"])],
    ]

    func phone(
        _ recipient: String = "codex", _ model: String = "gpt-6-luna", fast: Bool = false, plan: Bool = false,
        catalogs: ModelCatalogs? = nil
    ) -> CommandSettings {
        CommandSettings(recipient: recipient, model: model, fast: fast, plan: plan, catalogs: catalogs ?? self.catalogs)
    }

    @Test func modelCommands() {
        #expect(composerCommand("model", "not a model", phone()) == .error("Enter a valid model ID."))
        #expect(composerCommand("model", "gpt-7-preview", phone()) == .change(.model(provider: "codex", model: "gpt-7-preview")))
        #expect(composerCommand("model", "default", phone()) == .change(.model(provider: "codex", model: "")))
        #expect(composerCommand("model", "Opus", phone()) == .change(.model(provider: "claude", model: "opus")))
        #expect(composerCommand("model", "opus[1m]", phone()) == .change(.model(provider: "claude", model: "opus[1m]")))
        #expect(
            composerCommand("model", "sonnet", phone()) == .change(.model(provider: "opencode", model: "anthropic/sonnet")))
        #expect(
            modelCommandOptions("claude", catalogs, defaultNames: ["claude": "Opus"]).map { "\($0.provider):\($0.value)" }
                == ["claude:opus", "claude:opus[1m]", "claude:default", "codex:gpt-6-luna", "opencode:anthropic/sonnet"])
    }

    @Test func effortsFollowTheModel() {
        #expect(composerCommand("effort", "High", phone()) == .change(.effort("high")))
        #expect(composerCommand("effort", "ultra", phone()) == .error("Choose one of: default, low, medium, high."))
        #expect(composerCommand("effort", "max", phone("claude", "opus")) == .change(.effort("max")))
        #expect(composerCommand("effort", "ultra", phone("codex", "gpt-7-preview")) == .change(.effort("ultra")))
        #expect(composerCommand("effort", "high", phone("opencode", "")) == .error("Choose one of: default."))
    }

    @Test func togglesAndFastChecks() {
        #expect(composerCommand("plan", "", phone(plan: true)) == .change(.plan(false)))
        #expect(composerCommand("fast", "ON", phone(fast: true)) == .change(.fast(true)))
        #expect(composerCommand("plan", "maybe", phone()) == .error("Use /plan on or /plan off."))
        #expect(
            composerCommand("fast", "", phone("claude"))
                == .error("Fast mode is only available for Codex and supported Cursor models."))
        var grok = AgentModel(id: "grok-4.7", name: "Grok")
        grok.fast = true
        let cursor: ModelCatalogs = ["cursor": [grok]]
        #expect(composerCommand("fast", "on", phone("cursor", "grok-4.7", catalogs: cursor)) == .change(.fast(true)))
        #expect(
            composerCommand("fast", "on", phone("cursor", "auto", catalogs: cursor))
                == .error("Fast mode is not available for this Cursor model."))
        #expect(
            composerCommand("fast", "off", phone("cursor", "auto", fast: true, catalogs: [:])) == .change(.fast(false)))
        #expect(
            composerCommand("permissions", "Auto-accept edits", phone()) == .change(.permissions("auto-accept-edits")))
    }

    @Test func relayCommandsAndTriggers() {
        #expect(relayCommand("/compact keep tests") == ParsedCommand(name: "compact", args: "keep tests"))
        #expect(relayCommand("/context now") == nil)
        #expect(!startsWithCommand("/Users/me/clip.mp4"))
        let t = commandTrigger("fix it /mo")
        #expect(t?.prefix == "/")
        #expect(t?.query == "mo")
        #expect(t?.inline == true)
        #expect(commandTrigger("a/b") == nil)
        #expect(
            sideRefusal("amp")
                == "Amp can't answer beside the thread. Pick Codex, Claude, OpenCode or Muse to ask a side question.")
    }

    @Test func menuItems() {
        let skills = [ProviderCommand(name: "skill:review", description: "Review a diff", source: "repo")]
        // Codex: Relay's actions, then its skills; `$` lists skills alone and goes anywhere.
        let codex = commandItems("/", provider: "codex", commands: skills, hidden: ["openpr"])!
        #expect(codex.first?.label == "/changes")
        #expect(codex.last == CommandMenuItem(
            kind: .skill, name: "review", label: "/skill:review", description: "Review a diff", source: "Repo skill"))
        #expect(!codex.contains { $0.name == "openpr" })
        #expect(commandItems("check this $re", provider: "codex", commands: skills)?.map(\.label) == ["$review"])
        // Claude's commands stand alone; `/btw` only where the agent answers beside the thread.
        let claude = commandItems("/rev", provider: "claude", commands: [ProviderCommand(name: "review")])!
        #expect(claude.map(\.label) == ["/review"])
        #expect(commandItems("/bt", provider: "amp", commands: [])?.isEmpty == true)
        #expect(commandItems("fix it /mo", provider: "codex", commands: []) == nil)
        #expect(withSkill("check this $re", "review") == "check this $review ")
    }

    @Test func changesApply() {
        let on = ResumeSettings(
            provider: "codex", choice: ModelChoice(model: "gpt-6-luna", reasoningEffort: "high"),
            runtimeMode: "auto-accept-edits", interactionMode: "default")
        let moved = on.with(.model(provider: "claude", model: "opus"), catalogs)
        #expect(moved.provider == "claude")
        #expect(moved.choice.model == "opus")
        // Another agent starts on its Default; the same one keeps an effort its model takes.
        #expect(moved.choice.reasoningEffort == "")
        #expect(on.with(.model(provider: "codex", model: "gpt-6-luna"), catalogs).choice.reasoningEffort == "high")
        #expect(on.with(.plan(true), catalogs).interactionMode == "plan")
        #expect(on.with(.permissions("full-access"), catalogs).runtimeMode == "full-access")
    }
}
