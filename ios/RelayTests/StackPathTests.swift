import Testing

@testable import Relay

@MainActor
struct StackPathTests {
    @Test func testOnlyTheOriginalNewThreadEntryIsReplaced() {
        let stack = StackPath()
        let original = Route.newThread(projectId: "project")
        stack.routes = [.project("project"), original]
        stack.started("created", from: original)
        #expect(stack.routes == [.project("project"), .thread("created")])
    }

    @Test func testFinishingAfterBackKeepsTheCurrentNavigation() {
        let stack = StackPath()
        let original = Route.newThread(projectId: "project")
        stack.started("created", from: original)
        #expect(stack.routes.isEmpty)
        stack.routes = [.project("project")]
        stack.started("created", from: original)
        #expect(stack.routes == [.project("project")])

        let reopened = Route.newThread(projectId: "project")
        #expect(original != reopened)
        stack.routes.append(reopened)
        stack.started("created", from: original)
        #expect(stack.routes == [.project("project"), reopened])
    }
}
