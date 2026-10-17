import Foundation
import Testing

@testable import RelayRemote

// Mirrors shared/phone-compose.test.ts, model-fit.test.ts and Android's ComposeSendTest.

private func settings(_ provider: String, _ choice: ModelChoice, window: String? = nil) -> ResumeSettings {
    ResumeSettings(
        provider: provider, choice: choice, contextWindow: window, runtimeMode: "full-access", interactionMode: "default")
}

@Test func aNewThreadOpensOnTheRememberedModelFullAccessAndBuild() {
    let models = ["claude": NewThreadModel(choice: ModelChoice(model: "opus", reasoningEffort: "max"), contextWindow: "200k")]
    #expect(
        newThreadSettings(last: "claude", ai: nil, models: models)
            == settings("claude", ModelChoice(model: "opus", reasoningEffort: "max"), window: "200k"))
    // Codex picked for questions too starts on that model.
    let ai = NewThreadAI(threadProvider: "codex", questionsProvider: "codex", questions: ModelChoice(model: "gpt-6-sol"))
    #expect(newThreadSettings(last: nil, ai: ai, models: [:]).choice.model == "gpt-6-sol")
    #expect(newThreadSettings(last: "nobody-knows", ai: nil, models: [:]).provider == "codex")
    // A remembered Default leaves the agent's own.
    let blank = ["codex": NewThreadModel(choice: byDefault)]
    #expect(newThreadSettings(last: "codex", ai: ai, models: blank).choice.model == "gpt-6-sol")
}

@Test func anotherAgentStartsOnItsDefaultAndKeepsOnlyEffortsTheModelTakes() {
    let codex = settings("codex", ModelChoice(model: "gpt-6-sol", fast: true, reasoningEffort: "xhigh"))
    #expect(codex.onAgent("claude").onModel("opus", nil).choice == ModelChoice(model: "opus"))
    #expect(codex.onModel("gpt-6-luna", nil).choice == ModelChoice(model: "gpt-6-luna", fast: true, reasoningEffort: "xhigh"))
    let max = settings("codex", ModelChoice(model: "gpt-6-sol", reasoningEffort: "max"))
    #expect(max.onModel("gpt-5.5", nil).choice.reasoningEffort == "")
}

@Test func switchesClaudesWindowTheWayTheDesktopsControlDoes() {
    let on1m = settings("claude", ModelChoice(model: "opus[1m]"))
    let small = on1m.onWindow("200k")
    #expect(small.choice.model == "opus")
    #expect(small.contextWindow == "200k")
    #expect(small.onWindow("1m") == on1m)
    // Default stays Default, on Claude's own window.
    #expect(settings("claude", byDefault, window: "200k").onWindow("1m") == settings("claude", byDefault))
}

@Test func aSendKeepsFastAndTheWindowOnlyWhereTheAgentHasThem() {
    let claude = settings("claude", ModelChoice(model: "opus", fast: true, reasoningEffort: "high"), window: "200k")
    let sent = ProjectChatSend(body: "look", settings: claude)
    #expect(sent.choice == ModelChoice(model: "opus", reasoningEffort: "high"))
    #expect(sent.contextWindow == "200k")
    #expect(ProjectChatSend(body: "x", settings: claude.onWindow("1m")).contextWindow == nil)
    let codex = settings("codex", ModelChoice(model: "gpt-6-sol", fast: true), window: "200k")
    let fast = ProjectChatSend(body: "x", settings: codex)
    #expect(fast.choice.fast)
    #expect(fast.contextWindow == nil)
}

@Test func readsWhatAModelListLeavesOut() throws {
    let json = try JSON.parse(#"[{"id":"opus","name":"Opus 5.5","longContext":true},{"id":"x"}]"#)
    let models: [AgentModel] = try json.decode()
    #expect(models[0].efforts == [])
    #expect(models[0].longContext == true)
    #expect(models[1].name == "x")
    let defaults: AgentDefaults = try JSON.parse(#"{"effort":"high"}"#).decode()
    #expect(defaults.model == "")
}

@Test func namesWhatTheComposerIsOn() {
    let opus = AgentModel(id: "claude-opus-5-5", name: "Opus 5.5")
    let claude = settings("claude", ModelChoice(model: "claude-opus-5-5", fast: true, reasoningEffort: "high"), window: "200k")
    #expect(claude.label([opus]) == "Claude · Opus 5.5 · High · 200k")
    #expect(settings("codex", ModelChoice(model: "gpt-6-sol", fast: true)).label(nil) == "Codex · gpt-6-sol · Fast")
    #expect(agentName("acp:factory-droid") == "Factory Droid")
    #expect(!isAgentProvider("acp:Bad"))
}
