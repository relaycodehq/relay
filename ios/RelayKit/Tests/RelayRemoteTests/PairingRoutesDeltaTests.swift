import Foundation
import Testing
@testable import RelayRemote

/// Each case against what the TypeScript gave for the same input.
struct PairingRoutesDeltaTests {
    let ts = Fixtures.misc

    func list(_ key: String) -> [String] { ts[key]!.array!.map { $0.string! } }

    @Test func pairingLinksParseAsTheTSDoes() throws {
        for pair in ts["pairing"]!.array! {
            let input = pair.array![0].string!
            let got = try parsePairingURL(input).map { try JSON(encoding: $0) } ?? .null
            #expect(got == pair.array![1], "\(input)")
        }
    }

    @Test func pairingURLEncodesAsURLSearchParamsDoesAndParsesBack() {
        let link = PairingLink(
            hosts: ["192.168.1.2", "[fd7a:115c:a1e0::1]"], port: 47821,
            key: "B6N8vBQgk8i3VdwbEOhstCY3StFqqFPtC9_AsrhtHHw", code: "abcdefghijklmnop",
            name: "Lubo's Mac ✓ a+b&c=d ~*"
        )
        #expect(pairingURL(link) == ts["url"]!.string!)
        #expect(parsePairingURL(pairingURL(link)) == link)
    }

    @Test func routesRankAndLearnAsTheTSDoes() {
        let hosts = [
            "100.64.0.1", "192.168.1.2", "[fd7a:115c:a1e0::5]", "mac.tail1234.ts.net", "100.128.0.1", "10.0.0.1",
            "100.127.255.255", "mac.local",
        ]
        #expect(hosts.map { Routes.kind($0).rawValue } == list("kinds"))
        #expect(Routes.order(hosts) == list("order"))
        #expect(Routes.order(hosts, routes: [.tailscale, .local]) == list("orderTailscale"))
        #expect(Routes.learn(["a", "b", "c", "d", "e", "f", "g", "h", "i"], via: "z") == list("learn"))
        #expect(Routes.learn(["a", "z", "b"], via: "z") == list("learnDup"))
    }

    @Test func messagePatchAppliesWithUTF16OffsetsAndListHoles() throws {
        let prev = ts["prev"]!.object!
        #expect(JSON.object(applyMessagePatch(prev, ts["patch"]!.object!)) == ts["applied"]!)
        let sparse = try JSON.parse(#"{"id":"m1","trace":{"length":5,"items":[[4,{"kind":"commentary","id":"t5","text":"e"}]]}}"#)
        #expect(JSON.object(applyMessagePatch(prev, sparse.object!)) == ts["sparse"]!)
    }

    @Test func threadListPatchAppliesInChatOrder() throws {
        let prev = try ts["chatsPrev"]!.decode([RemoteChatSummary].self)
        let patch = try ts["chatsPatch"]!.decode(ChatsPatch.self)
        #expect(try JSON(encoding: applyChatsPatch(prev, patch)) == ts["chatsApplied"]!)
    }

    @Test func chatAnswerReusesHeldMessagesAndRefusesUnknownIds() throws {
        func message(_ id: String, _ version: Int) -> String {
            #"{"id":"\#(id)","role":"user","body":"b\#(id)","status":"complete","created":1,"provider":"claude","version":\#(version)}"#
        }
        let chat =
            #"{"id":"c","projectId":"p","title":"T","scope":{"kind":"project"},"running":false,"earlier":0,"queue":[],"scheduled":[],"futureField":1,"#
        let first = try applyChatPatch(
            JSON.parse(chat + #""messages":[\#(message("a", 1)),\#(message("b", 1))]}"#).object!, previous: nil)
        let second = try applyChatPatch(
            JSON.parse(chat + #""messages":["a",\#(message("b", 2))]}"#).object!, previous: first)
        #expect(second.messages[0] == first.messages[0])
        #expect(second.messages[1].version == 2)
        #expect(throws: MissingMessage.self) {
            try applyChatPatch(JSON.parse(chat + #""messages":["zzz"]}"#).object!, previous: first)
        }
    }

    @Test func newerVersionComparesFourNumericParts() {
        #expect(newerVersion("0.12.1", "0.12.0"))
        #expect(newerVersion("0.12.0.3", "0.12.0"))
        #expect(!newerVersion("0.12.0", "0.12.0.0"))
        #expect(!newerVersion("0.9.0", "0.12.0"))
    }

    @Test func jsonWritesWholeNumbersWithoutAFraction() throws {
        let frame: JSON = ["t": "call", "id": 1, "args": [1.5, nil, true]]
        #expect(try JSON.parse(frame.text()) == frame)
        #expect(JSON.number(1).text() == "1")
        #expect(JSON.string("a\"\n\u{1}").text() == #""a\"\n\u0001""#)
    }

    @Test func anOptionalFieldOfAnotherShapeReadsAsAbsent() throws {
        let chat: JSON = ["id": "c", "worktree": true, "title": "Still here"]
        struct Thread: Decodable { var id: String; var worktree: [String: JSON]?; var title: String? }
        let thread: Thread = try chat.decode()
        #expect(thread.worktree == nil)
        #expect(thread.title == "Still here")
        #expect(throws: DecodingError.self) { let _: Thread = try (["id": 1] as JSON).decode() }
    }
}
