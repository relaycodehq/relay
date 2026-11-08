import Foundation
import Testing

@testable import RelayRemote

// Android's VideoFilesTest.
struct VideosTests {
    let dir = FileManager.default.temporaryDirectory.appendingPathComponent("videos-\(UUID().uuidString)")
    let video = Data((0..<2500).map { UInt8($0 % 256) })

    /// Serves `video` in pieces of 1000 bytes, as the computer serves a megabyte.
    final class Asked: @unchecked Sendable { var offsets: [Int64] = [] }

    func serve(_ asked: Asked = Asked()) -> @Sendable (Int64) async throws -> VideoPart {
        let video = video
        return { offset in
            asked.offsets.append(offset)
            let end = min(video.count, Int(offset) + 1000)
            return VideoPart(size: Int64(video.count), data: video[Int(offset)..<end].base64EncodedString())
        }
    }

    @Test func downloadsAVideoPieceByPieceAndKeepsIt() async throws {
        let asked = Asked()
        let file = try await VideoFiles(dir: dir).download(key: "a", path: "/tmp/clip.mp4", fetch: serve(asked))
        #expect(try Data(contentsOf: file) == video)
        #expect(asked.offsets == [0, 1000, 2000])
        #expect(file.pathExtension == "mp4")
        // Played again, it comes from the phone.
        _ = try await VideoFiles(dir: dir).download(key: "a", path: "/tmp/clip.mp4", fetch: serve(asked))
        #expect(asked.offsets.count == 3)
    }

    @Test func dropsTheLeastRecentlyPlayedPastItsRoom() async throws {
        let files = VideoFiles(dir: dir, keepBytes: 6000)
        let first = try await files.download(key: "a", path: "a.mp4", fetch: serve())
        try FileManager.default.setAttributes([.modificationDate: Date(timeIntervalSince1970: 1)], ofItemAtPath: first.path)
        _ = try await files.download(key: "b", path: "b.mp4", fetch: serve())
        let third = try await files.download(key: "c", path: "c.mp4", fetch: serve())
        #expect(!FileManager.default.fileExists(atPath: first.path))
        #expect(FileManager.default.fileExists(atPath: third.path))
    }

    @Test func refusesAVideoTooBigToPull() async {
        await #expect(throws: VideoTooBig.self) {
            try await VideoFiles(dir: dir).download(key: "a", path: "a.mp4") { _ in
                VideoPart(size: maxVideoBytes + 1, data: "")
            }
        }
    }
}
