import Foundation
import Testing

@testable import RelayRemote

// shared/answer-images.test.ts and Android's ImagesTest.
struct ImagesTests {
    let root = "/work/relay"

    @Test func resolvesTheFormsAnAgentWritesAnImageIn() {
        #expect(localImagePath("/tmp/after.png", root: root) == "/tmp/after.png")
        #expect(localImagePath("docs/shot.png", root: root) == "/work/relay/docs/shot.png")
        #expect(localImagePath("./a/../b.jpg", root: root) == "/work/relay/b.jpg")
        #expect(localImagePath("file:///tmp/my%20shot.png", root: root) == "/tmp/my shot.png")
        #expect(localImagePath("shots/my%20shot.webp", root: root) == "/work/relay/shots/my shot.webp")
    }

    @Test func leavesOutWhatIsntALocalImage() {
        #expect(localImagePath("https://example.com/a.png", root: root) == nil)
        #expect(localImagePath("data:image/png;base64,AAAA", root: root) == nil)
        #expect(localImagePath("/etc/passwd", root: root) == nil)
        #expect(localImagePath("notes.svg", root: root) == nil)
        #expect(localImagePath("%E0%A4%A.png", root: root) == nil)
    }

    @Test func listsOnlyEmbeddedImages() {
        let body = [
            #"Before: ![](/tmp/before.png) and after: ![after](<shots/after.png> "title")"#,
            "A [link](/tmp/link.png), `/tmp/code.png`, and ![](https://x.dev/r.png).",
            "Again ![](/tmp/before.png), and ![shot](</tmp/my screenshot.png>)",
        ].joined(separator: "\n")
        #expect(
            answerImagePaths(body, root: root) == [
                "/tmp/before.png", "/work/relay/shots/after.png", "/tmp/my screenshot.png",
            ])
    }

    private func message(_ status: String) throws -> ChatMessage {
        func read(_ id: String, _ path: String, _ status: String = "complete") -> String {
            #"{"kind":"activity","id":"\#(id)","activity":{"id":"\#(id)","kind":"read","label":"\#(path)","status":"\#(status)"}}"#
        }
        let trace = [read("a", "/tmp/shown.png"), read("b", "/tmp/read.png"), read("c", "/tmp/run.png", "running")]
        let json = """
            {"id":"m","role":"assistant","body":"See ![s](/tmp/shown.png)","status":"\(status)","created":0,
             "provider":"claude","version":1,
             "images":[{"id":"i1","name":"paste.png","mimeType":"image/png","sizeBytes":10}],
             "trace":[\(trace.joined(separator: ","))]}
            """
        return try JSONDecoder().decode(ChatMessage.self, from: Data(json.utf8))
    }

    @Test func ordersPastedThenShownThenReadOnceTheTurnEnds() throws {
        let done = MessageImages(chatId: "c", message: try message("complete"), root: root)
        #expect(
            done.all.map(\.source) == [
                .attached(chatId: "c", imageId: "i1"), .read(chatId: "c", messageId: "m", path: "/tmp/shown.png"),
                .read(chatId: "c", messageId: "m", path: "/tmp/read.png"),
            ])
        #expect(done.strip.map(\.name) == ["paste.png", "read.png"])
        #expect(done.looked.count == 2)

        let streaming = MessageImages(chatId: "c", message: try message("streaming"), root: root)
        #expect(streaming.all.map(\.source) == [.attached(chatId: "c", imageId: "i1")])
        #expect(streaming.looked.count == 2)
    }
}
