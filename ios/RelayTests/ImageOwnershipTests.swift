import RelayRemote
import Testing

@testable import Relay

@MainActor
struct ImageOwnershipTests {
    @Test func switchingBeforeTheCacheTaskStartsCannotReadOrCacheTheOtherComputersImage() async throws {
        try await ReadOwnershipFixture.run { fixture in
            let connection = fixture.connection
            let source = ImageSource.attached(chatId: "same-chat", imageId: "same-image")
            let keyA = Pictures.key(connection, source, max: 128)
            #expect(connection.canShrinkImages)
            // Runs Pictures.load synchronously up to its first suspension, after it
            // binds the request and enqueues the child task, without letting that
            // child start. No sleeps or assumptions about relative task priorities.
            let read = Task.immediate { try await Pictures.load(connection, source, max: 128) }
            #expect(fixture.a.imageCalls.isEmpty)
            connection.switchTo(fixture.b.credentials.key)
            #expect(!connection.canShrinkImages)
            do {
                let image = try await read.value
                #expect(image.size.width == 1)
            } catch {
                // Switching closes A. Its captured client may either finish the
                // original read or refuse it; neither outcome may touch B.
                #expect(error is RemoteCallError)
            }
            #expect(fixture.b.imageCalls.isEmpty)
            #expect(Pictures.cached(keyA).map { $0.size.width == 1 } ?? true)
            #expect(Pictures.cached(Pictures.key(connection, source, max: 128)) == nil)
        }
    }

    @Test func anUnchangedConnectionCachesItsImageAndReusesTheDecodedResult() async throws {
        try await ReadOwnershipFixture.run { fixture in
            let connection = fixture.connection
            let source = ImageSource.attached(chatId: "same-chat", imageId: "same-image")
            let first = try await Pictures.load(connection, source, max: 128)
            let second = try await Pictures.load(connection, source, max: 128)
            #expect(first === second)
            #expect(first.size.width == 1)
            #expect(fixture.a.imageCalls.count == 1)
            #expect(fixture.a.imageCalls.first?.args.last?.number == 128)
            #expect(fixture.b.imageCalls.isEmpty)
        }
    }
}
