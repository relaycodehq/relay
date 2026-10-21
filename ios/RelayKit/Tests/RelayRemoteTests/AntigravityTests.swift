import Foundation
import Testing

@testable import RelayRemote

struct AntigravityTests {
    @Test func preservesNativeFixedChoiceIdsAndQuotaPoolNames() throws {
        let question = try JSONDecoder().decode(
            AgentQuestion.self,
            from: Data(#"""
            {"id":"interaction_env","question":"Which environment?","allowCustomAnswer":false,
             "options":[{"label":"Same","value":"dev"},{"label":"Same","value":"prod"}]}
            """#.utf8))
        #expect(question.allowCustomAnswer == false)
        #expect(question.options?.map(\.selectionValue) == ["dev", "prod"])
        let window = try JSONDecoder().decode(
            UsageWindow.self,
            from: Data(#"""
            {"id":"3p-5h","label":"Claude & GPT · 5h","kind":"session",
             "usedPercent":25,"resetsAt":null,"periodMs":18000000}
            """#.utf8))
        #expect(presentWindow(window, now: 0).label == "Claude & GPT · 5h")
        #expect(reportsUsage("antigravity"))
    }

    @Test func batchesDoNotPretendTheirChildrenSucceededOrCanBeStopped() throws {
        let run = try JSONDecoder().decode(
            SubagentRun.self,
            from: Data(#"""
            {"id":"batch","description":"Antigravity subagent batch","status":"idle",
             "canStop":false,"started":0,"calls":0,"recent":[]}
            """#.utf8))
        #expect(run.canStop == false)
        #expect(subagentNow(run) == "Child status unavailable")
    }
}
