import RelayRemote
import Testing

@testable import Relay

@MainActor
struct GitOwnershipTests {
    private func loaded(_ fixture: ReadOwnershipFixture) async throws -> ChangesModel {
        let model = ChangesModel(where: "same-project")
        model.bind(fixture.connection)
        let read = Task { await model.load() }
        try await fixture.until { fixture.a.pendingDesktop == 1 }
        try fixture.a.answerDesktop(JSON(encoding: WorkingTree(branch: "dev", revision: "before")))
        await read.value
        model.message = "A commit"
        return model
    }

    @Test func switchingAfterCommitCompletesCannotPushOrRefreshAnotherComputer() async throws {
        try await ReadOwnershipFixture.run { fixture in
            let model = try await loaded(fixture)
            model.commit(["file.txt"], push: true)
            try await fixture.until { fixture.a.pendingDesktop == 1 }
            try fixture.a.answerDesktop(JSON(encoding: WorkingTree(branch: "dev", revision: "committed")))
            fixture.connection.switchTo(fixture.b.credentials.key)
            try await fixture.until { model.busy == nil || !fixture.b.desktopCalls.isEmpty }
            #expect(fixture.b.desktopCalls.isEmpty)
            // Also release the misrouted push when demonstrating the regression.
            if fixture.b.pendingDesktop > 0 {
                try fixture.b.answerDesktop(JSON(encoding: WorkingTree(branch: "dev", revision: "wrong-computer")))
            }
            try await fixture.until { model.busy == nil }
        }
    }

    @Test func queuedActionsStayBoundToTheComputerWhereTheModelWasOpened() async throws {
        try await ReadOwnershipFixture.run { fixture in
            let model = try await loaded(fixture)
            // The action's child task cannot start before this actor switches.
            model.act(.fetch, .fetch)
            fixture.connection.switchTo(fixture.b.credentials.key)
            try await fixture.until { model.busy == nil || !fixture.b.desktopCalls.isEmpty }
            #expect(fixture.b.desktopCalls.isEmpty)
            if fixture.b.pendingDesktop > 0 {
                try fixture.b.answerDesktop(JSON(encoding: WorkingTree(branch: "dev", revision: "wrong-computer")))
            }
            try await fixture.until { model.busy == nil }
        }
    }

    @Test func commitAndPushUseTheOriginalComputerWhenItStaysSelected() async throws {
        try await ReadOwnershipFixture.run { fixture in
            let model = try await loaded(fixture)
            model.commit(["file.txt"], push: true)
            try await fixture.until { fixture.a.pendingDesktop == 1 }
            try fixture.a.answerDesktop(JSON(encoding: WorkingTree(branch: "dev", revision: "committed")))
            try await fixture.until { fixture.a.pendingDesktop == 1 }
            let action = fixture.a.desktopCalls.last?.args.last?.array?.last
            #expect(action?["kind"]?.string == "push")
            #expect(action?["revision"]?.string == "committed")
            try fixture.a.answerDesktop(JSON(encoding: WorkingTree(branch: "dev", revision: "pushed")))
            try await fixture.until { model.busy == nil }
            #expect(fixture.b.desktopCalls.isEmpty)
            #expect(model.tree?.revision == "pushed")
        }
    }
}
