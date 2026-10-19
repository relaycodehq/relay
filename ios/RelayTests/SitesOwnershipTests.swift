import RelayRemote
import Testing

@testable import Relay

@MainActor
struct SitesOwnershipTests {
    @Test func queuedResponseCannotReplaceAnotherComputersPorts() async throws {
        try await ReadOwnershipFixture.run { fixture in
            let connection = fixture.connection
            let b = fixture.b.credentials.key
            connection.tunnelPorts.sawSites([2222], on: b)
            let read = Task { try await connection.sites() }
            try await fixture.until { fixture.a.pendingSites == 1 }
            try fixture.a.answerSites([1111])
            connection.switchTo(b)
            await #expect(throws: CancellationError.self) { try await read.value }
            #expect(connection.tunnelPorts.allows(2222, on: b))
            #expect(!connection.tunnelPorts.allows(1111, on: b))
        }
    }

    @Test func queuedResponseCannotReplaceANewerClientForTheSameComputer() async throws {
        try await ReadOwnershipFixture.run { fixture in
            _ = try await fixture.replaceA()
            let connection = fixture.connection
            let a = fixture.a.credentials.key
            connection.tunnelPorts.sawSites([3333], on: a)
            let read = Task { try await connection.sites() }
            try await fixture.until { fixture.a.pendingSites == 1 }
            try fixture.a.answerSites([1111])
            connection.switchTo(fixture.b.credentials.key)
            connection.switchTo(a)
            await #expect(throws: CancellationError.self) { try await read.value }
            #expect(connection.tunnelPorts.allows(3333, on: a))
            #expect(!connection.tunnelPorts.allows(1111, on: a))
        }
    }

    @Test func cancellationDoesNotPublishAResponseFromTheCurrentClient() async throws {
        try await ReadOwnershipFixture.run { fixture in
            let connection = fixture.connection
            let a = fixture.a.credentials.key
            connection.tunnelPorts.sawSites([3333], on: a)
            let read = Task { try await connection.sites() }
            try await fixture.until { fixture.a.pendingSites == 1 }
            read.cancel()
            try fixture.a.answerSites([1111])
            await #expect(throws: CancellationError.self) { try await read.value }
            #expect(connection.tunnelPorts.allows(3333, on: a))
            #expect(!connection.tunnelPorts.allows(1111, on: a))
        }
    }

    @Test func currentResponseReturnsTheSitesAndUpdatesOnlyItsComputersPorts() async throws {
        try await ReadOwnershipFixture.run { fixture in
            let connection = fixture.connection
            let a = fixture.a.credentials.key, b = fixture.b.credentials.key
            connection.tunnelPorts.sawSites([2222], on: b)
            let read = Task { try await connection.sites() }
            try await fixture.until { fixture.a.pendingSites == 1 }
            try fixture.a.answerSites([1111])
            #expect(try await read.value.map(\.port) == [1111])
            #expect(connection.tunnelPorts.allows(1111, on: a))
            #expect(!connection.tunnelPorts.allows(1111, on: b))
            #expect(connection.tunnelPorts.allows(2222, on: b))
        }
    }
}
