import RelayRemote
import Testing

@testable import Relay

@MainActor
struct FilesOwnershipTests {
    @Test func queuedResponseCannotReplaceAnotherComputersFiles() async throws {
        try await ReadOwnershipFixture.run { fixture in
            let connection = fixture.connection
            let b = fixture.b.credentials.key
            FileLists.keep(["b.txt"], b, "same-project")
            let read = Task { try await FileLists.load(connection, "same-project") }
            try await fixture.until { fixture.a.pendingDesktop == 1 }
            try fixture.a.answerDesktop(["a.txt"])
            connection.switchTo(b)
            await #expect(throws: CancellationError.self) { try await read.value }
            #expect(FileLists.known(b, "same-project") == ["b.txt"])
        }
    }

    @Test func queuedResponseCannotReplaceANewerConnectionForTheSameComputer() async throws {
        try await ReadOwnershipFixture.run { fixture in
            _ = try await fixture.replaceA()
            let connection = fixture.connection
            let a = fixture.a.credentials.key
            let read = Task { try await FileLists.load(connection, "same-project") }
            try await fixture.until { fixture.a.pendingDesktop == 1 }
            try fixture.a.answerDesktop(["old.txt"])
            connection.switchTo(fixture.b.credentials.key)
            connection.switchTo(a)
            FileLists.keep(["newer.txt"], a, "same-project")
            await #expect(throws: CancellationError.self) { try await read.value }
            #expect(FileLists.known(a, "same-project") == ["newer.txt"])
        }
    }

    @Test func cancellationCannotPublishACompletedFileList() async throws {
        try await ReadOwnershipFixture.run { fixture in
            let connection = fixture.connection
            let a = fixture.a.credentials.key
            FileLists.keep(["kept.txt"], a, "same-project")
            let read = Task { try await FileLists.load(connection, "same-project") }
            try await fixture.until { fixture.a.pendingDesktop == 1 }
            read.cancel()
            try fixture.a.answerDesktop(["discarded.txt"])
            await #expect(throws: CancellationError.self) { try await read.value }
            #expect(FileLists.known(a, "same-project") == ["kept.txt"])
        }
    }

    @Test func currentResponseCachesOnlyItsOwnComputersFiles() async throws {
        try await ReadOwnershipFixture.run { fixture in
            let connection = fixture.connection
            let a = fixture.a.credentials.key, b = fixture.b.credentials.key
            FileLists.keep(["b.txt"], b, "same-project")
            let read = Task { try await FileLists.load(connection, "same-project") }
            try await fixture.until { fixture.a.pendingDesktop == 1 }
            try fixture.a.answerDesktop(["a.txt"])
            #expect(try await read.value == ["a.txt"])
            #expect(FileLists.known(a, "same-project") == ["a.txt"])
            #expect(FileLists.known(b, "same-project") == ["b.txt"])
        }
    }
}
