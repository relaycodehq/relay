import Foundation
import Testing

@testable import RelayRemote

// Android's FilesTest: files a message takes along (shared/remote.ts `uploadFile`).

/// A computer keeping uploads as electron/drafts/uploads does: a repeat is skipped, a gap ignored.
private actor Computer: OutboxLink {
    var files: [String: Data] = [:]
    var sends: [ProjectChatSend] = []
    /// Calls that fail before they reach it, as a dropped link does.
    var dropping = 0
    /// Calls whose answer is lost after it took the chunk.
    var losingAnswers = 0
    var calls = 0

    func drop(_ n: Int) { dropping = n }
    func loseAnswers(_ n: Int) { losingAnswers = n }

    func uploadFile(id: String, name: String, size: Int64, offset: Int64, data: String) async throws -> UploadedFile {
        calls += 1
        if dropping > 0 {
            dropping -= 1
            throw RemoteCallError.unanswered("Connection lost.")
        }
        var have = files[id] ?? Data()
        let bytes = Data(base64Encoded: data)!
        if offset <= Int64(have.count), offset + Int64(bytes.count) > Int64(have.count) {
            have.append(bytes.suffix(from: Int(Int64(have.count) - offset)))
        }
        files[id] = have
        if losingAnswers > 0 {
            losingAnswers -= 1
            throw RemoteCallError.unanswered("Connection lost.")
        }
        let received = Int64(have.count)
        return UploadedFile(received: received, path: received == size ? "/data/pastes/\(id)/\(name)" : nil)
    }

    func send(chatId: String, _ send: ProjectChatSend) async throws { sends.append(send) }
    func sendDraft(key: String, chatId: String, _ send: ProjectChatSend) async throws { sends.append(send) }
    func chat(_ chatId: String, sendId: String) async throws -> RemoteChat {
        throw RemoteCallError.rejected("Not here.")
    }
}

private func bytes(_ n: Int) -> Data { Data((0..<n).map { UInt8($0 % 251) }) }

@MainActor
private func until(_ done: () async -> Bool) async {
    for _ in 0..<5000 where !(await done()) { await Task.yield() }
}

struct FilesTests {
    @Test func stepsThroughAFileFromWhatTheComputerHas() {
        #expect(nextChunk(size: 10, received: 0, chunk: 4) == 0..<4)
        #expect(nextChunk(size: 10, received: 8, chunk: 4) == 8..<10)
        #expect(nextChunk(size: 10, received: 12, chunk: 4) == 10..<10)
        #expect(nextChunk(size: 0, received: 0, chunk: 4) == 0..<0)
    }

    @Test func saysHowBigAFileIs() {
        #expect(fileSizeLabel(820) == "820 B")
        #expect(fileSizeLabel(64 * 1024 + 100) == "64 KB")
        #expect(fileSizeLabel(13_002_342) == "12.4 MB")
        #expect(fileSizeLabel(150 * 1024 * 1024 + 1) == "150 MB")
    }

    @Test func namesEachFileOnALineOfItsOwnAfterTheText() {
        #expect(bodyWithFiles("@claude Why does it jump?", ["/a/clip.mp4"]) == "@claude Why does it jump?\n`/a/clip.mp4`")
        #expect(bodyWithFiles("@claude", ["/a/1.mp4", "/a/2.log"]) == "@claude\n`/a/1.mp4`\n`/a/2.log`")
        #expect(bodyWithFiles("", ["/a/clip.mp4"]) == "`/a/clip.mp4`")
        #expect(bodyWithFiles("Hi", []) == "Hi")
    }

    @Test func showsAFileAMessageTookAlongByItsName() {
        let id = "0f8fad5b-d9cb-469f-a165-70867728950e"
        #expect(
            sentPieces("Look at this\n`/Users/me/Library/Application Support/Relay/pastes/\(id)/clip.mp4`")
                == [.text("Look at this\n"), .file("clip.mp4")])
        #expect(sentPieces("`C:\\Users\\me\\Relay\\pastes\\\(id)\\log.txt` and more") == [.file("log.txt"), .text(" and more")])
        #expect(sentPieces("`/src/pastes/not-an-id/a.txt`") == [.text("`/src/pastes/not-an-id/a.txt`")])
        #expect(sentPieces("plain") == [.text("plain")])
    }

    @Test func startsOverUnderANewIdOnAnotherComputer() {
        let file = FileAttachment(name: "clip.mp4", size: 10, local: "x/clip.mp4", computer: "A", received: 10, path: "/p")
        #expect(file.going(to: "A") == file)
        let moved = file.going(to: "B")
        #expect(moved.id != file.id)
        #expect(moved.computer == "B" && moved.received == 0 && moved.path == nil)
        #expect(FileAttachment(name: "a", size: 10, local: "a").going(to: "B").computer == "B")
    }

    @Test func triesAgainOnlyAsOftenAsItsDelaysSay() async throws {
        actor Waits {
            var all: [Duration] = []
            func add(_ d: Duration) { all.append(d) }
        }
        let waited = Waits()
        var tries = 0
        await #expect(throws: RemoteCallError.self) {
            try await retrying(sleep: { _ in }) {
                tries += 1
                throw RemoteCallError.unanswered("Connection lost.")
            }
        }
        #expect(tries == 4)
        tries = 0
        await #expect(throws: RemoteCallError.self) {
            try await retrying(sleep: { _ in }) {
                tries += 1
                throw RemoteCallError.rejected(Files.needsUpdate)
            }
        }
        #expect(tries == 1)
        tries = 0
        let value = try await retrying(sleep: { await waited.add($0) }) {
            tries += 1
            if tries < 3 { throw RemoteCallError.unanswered("Connection lost.") }
            return "done"
        }
        #expect(value == "done")
        #expect(await waited.all == [.seconds(2), .seconds(8)])
    }

    @Test func carriesOnFromWhatTheComputerSaysAfterALostAnswer() async throws {
        let dir = FileManager.default.temporaryDirectory.appending(path: "relay files-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: dir) }
        let folder = FileFolder(root: dir)
        let (url, local) = try folder.place("clip.mp4")
        let data = bytes(Files.chunk * 2 + 10)
        try data.write(to: url)
        let computer = Computer()
        await computer.loseAnswers(1)
        let file = FileAttachment(name: "clip.mp4", size: Int64(data.count), local: local)
        await #expect(throws: RemoteCallError.self) { try await upload(file, from: url, to: "A", via: computer) }
        // The first chunk got there though its answer didn't; the next try sends it again and is told to move on.
        let done = try await upload(file, from: url, to: "A", via: computer)
        #expect(done.path == "/data/pastes/\(file.id)/clip.mp4")
        #expect(await computer.files[file.id] == data)
        #expect(await computer.calls == 4)
    }

    @Test func keepsOnlyTheCopiesItsSendsStillNeed() throws {
        let dir = FileManager.default.temporaryDirectory.appending(path: "relay files-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: dir) }
        let folder = FileFolder(root: dir)
        let kept = try folder.place("a.mp4")
        let gone = try folder.place("../b.log")
        #expect(gone.local.hasSuffix("/b.log"))
        try Data([1]).write(to: kept.url)
        try Data([2]).write(to: gone.url)
        folder.sweep(keeping: [FileAttachment(name: "a.mp4", size: 1, local: kept.local)])
        #expect(FileManager.default.fileExists(atPath: kept.url.path(percentEncoded: false)))
        #expect(!FileManager.default.fileExists(atPath: gone.url.path(percentEncoded: false)))
    }
}

@MainActor
struct OutboxFilesTests {
    private let settings = ResumeSettings(
        provider: "codex", choice: ModelChoice(model: ""), runtimeMode: "full-access", interactionMode: "default")

    @Test func uploadsItsFilesThenSendsNamingThemAndLetsTheCopiesGo() async throws {
        let root = FileManager.default.temporaryDirectory.appending(path: "outbox files-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: root) }
        let outbox = Outbox(dir: root.appending(path: "sends"), files: root.appending(path: "files"))
        let folder = try #require(outbox.files)
        let (url, local) = try folder.place("clip.mp4")
        let data = bytes(Files.chunk + 5)
        try data.write(to: url)
        let file = FileAttachment(name: "clip.mp4", size: Int64(data.count), local: local)
        let computer = Computer()
        await computer.drop(1)
        outbox.retryDelays = [.zero]
        let send = ProjectChatSend(body: "Why does it jump?", settings: settings)
        let pending = outgoingMessage(Outgoing(computer: "A", chatId: "c", send: send, created: 0, files: [file])).body
        #expect(sentPieces(pending) == [.text("@codex Why does it jump?\n"), .file("clip.mp4")])

        // A drop on the way is tried again by itself.
        outbox.deliver(computer, computer: "A", chatId: "c", send, files: [file])
        await until { await !computer.sends.isEmpty }
        let sent = try #require(await computer.sends.first)
        #expect(sent.body == "@codex Why does it jump?\n`/data/pastes/\(file.id)/clip.mp4`")
        #expect(await computer.files[file.id] == data)
        await until { !FileManager.default.fileExists(atPath: url.path(percentEncoded: false)) }
        #expect(!FileManager.default.fileExists(atPath: url.path(percentEncoded: false)))
    }

    @Test func aFailedUploadWaitsForTryAgainAndSurvivesALaunch() async throws {
        let root = FileManager.default.temporaryDirectory.appending(path: "outbox files-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: root) }
        let sends = root.appending(path: "sends"), files = root.appending(path: "files")
        let outbox = Outbox(dir: sends, files: files)
        let (url, local) = try #require(outbox.files).place("notes.txt")
        try bytes(100).write(to: url)
        let file = FileAttachment(name: "notes.txt", size: 100, local: local)
        // Too old for files: no tries after the first.
        struct Old: OutboxLink {
            func send(chatId: String, _ send: ProjectChatSend) async throws {}
            func sendDraft(key: String, chatId: String, _ send: ProjectChatSend) async throws {}
            func chat(_ chatId: String, sendId: String) async throws -> RemoteChat { throw RemoteCallError.rejected("") }
        }
        let send = ProjectChatSend(body: "Read this", settings: settings)
        outbox.deliver(Old(), computer: "A", chatId: "c", send, files: [file])
        await until { outbox.items.first?.error != nil }
        let failed = try #require(outbox.items.first)
        #expect(failed.error == Files.needsUpdate)
        #expect(failed.refused == true)
        #expect(failed.unsure == nil)

        let next = Outbox(dir: sends, files: files)
        #expect(next.items.first?.files == [file.going(to: "A")] || next.items.first?.files == [file])
        #expect(FileManager.default.fileExists(atPath: url.path(percentEncoded: false)))
        let computer = Computer()
        next.retry(computer, send.id)
        await until { next.items.first?.sent != nil }
        #expect(await computer.sends.first?.body == "@codex Read this\n`/data/pastes/\(file.id)/notes.txt`")
        next.drop(send.id)
        #expect(!FileManager.default.fileExists(atPath: url.path(percentEncoded: false)))
    }

    @Test func aLaunchNeverDoubtsASendWhoseFileHadntArrived() async throws {
        let root = FileManager.default.temporaryDirectory.appending(path: "outbox files-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: root) }
        let sends = root.appending(path: "sends"), files = root.appending(path: "files")
        let outbox = Outbox(dir: sends, files: files)
        let (url, local) = try #require(outbox.files).place("clip.mp4")
        try bytes(10).write(to: url)
        let computer = Computer()
        await computer.drop(10)
        let send = ProjectChatSend(body: "x", settings: settings)
        outbox.deliver(computer, computer: "A", chatId: "c", send, files: [FileAttachment(name: "clip.mp4", size: 10, local: local)])
        let next = Outbox(dir: sends, files: files)
        #expect(next.items.first?.unsure == nil)
        #expect(next.items.first?.error == "Relay closed before it went out")
    }
}
