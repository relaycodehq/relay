import Foundation
import Testing
@testable import RelayRemote

/// The cases from Android's DictationTest and ComposeSend, which follow shared/.
struct ComposerTests {
    @Test func dictatedWordsTakeTheCaseOfWhereTheyLand() {
        #expect(fitCase("Fix the test.", before: "Please ") == "fix the test.")
        #expect(fitCase("fix the test.", before: "") == "Fix the test.")
        #expect(fitCase("fix the test.", before: "Done. ") == "Fix the test.")
        #expect(fitCase("I think so.", before: "and ") == "I think so.")
        #expect(fitCase("I'll check.", before: "then ") == "I'll check.")
        #expect(fitCase("CI is red.", before: "the ") == "CI is red.")
    }

    @Test func dictatedWordsAreSpacedFromTheTextAround() {
        #expect(placeDictation("Please", from: 6, to: 6, words: "Fix the test") == PlacedDictation(text: "Please fix the test", start: 7, end: 19))
        #expect(placeDictation("Done.then", from: 5, to: 5, words: "check it").text == "Done. Check it then")
        #expect(placeDictation("fix it.", from: 3, to: 3, words: "the test").text == "fix the test it.")
        #expect(placeDictation("fix\n.", from: 4, to: 4, words: "Tests").text == "fix\nTests.")
        #expect(placeDictation("a  b", from: 1, to: 3, words: "").text == "ab")
        #expect(placeDictation("Hello  world", from: 6, to: 6, words: "Shiny.").text == "Hello shiny world")
        #expect(placeDictation("Hello new .", from: 10, to: 10, words: "World.").text == "Hello new world.")
        #expect(placeDictation("Done.  Ship it", from: 6, to: 6, words: "Test it.").text == "Done. Test it. Ship it")
    }

    @Test func aThreadMadeHereIsTitledAsTheComputerTitlesIt() {
        #expect(promptTitle("@claude Fix the login bug") == "Fix the login bug")
        #expect(promptTitle("@acp:goose  tidy up") == "tidy up")
        #expect(promptTitle("@codex ") == "Screenshot")
        #expect(promptTitle("@claude\n\nPasted text #1:\n\n```\n  first line\nsecond\n```") == "first line")
        #expect(promptTitle(String(repeating: "word ", count: 20)).count == 65)
    }

    @Test func chunksGoAsLittleEndianPCM() {
        #expect(Data(base64Encoded: encodePCM([1, -2])).map(Array.init) == [1, 0, 0xfe, 0xff])
        #expect(meanSquare([1, 2] as [Int16]) == (pow(1.0 / 32768, 2) + pow(2.0 / 32768, 2)) / 2)
        #expect(loudness(0) == 0)
        #expect(loudness(1) == 1)
        let full = [Int16](repeating: 0x7fff, count: DictationFormat.maxSamplesPerCall)
        #expect(encodePCM(full).count <= 44_000)
    }

    let settings = ResumeSettings(
        provider: "claude", choice: ModelChoice(model: "claude-opus-5-5"), contextWindow: nil,
        runtimeMode: "full-access", interactionMode: "default")

    @Test func aSendNamesItsAgentAsEveryComposerDoes() throws {
        let plain = ProjectChatSend(body: " fix it \n", settings: settings)
        #expect(plain.body == "@claude fix it")
        #expect(plain.to == "claude")
        #expect(ProjectChatSend(body: "@codex look", settings: settings).body == "@codex look")
        // The agent the text names answers, on its Default.
        let named = ProjectChatSend(body: "@codex look", settings: settings.onWindow("200k"))
        #expect(named.to == "codex")
        #expect(named.provider == "codex")
        #expect(named.choice == ModelChoice(model: ""))
        #expect(named.contextWindow == nil)
        let registry = ResumeSettings(
            provider: "acp:goose", choice: settings.choice, contextWindow: nil,
            runtimeMode: "full-access", interactionMode: "default")
        #expect(ProjectChatSend(body: "hi", settings: registry).body == "hi")
        #expect(withoutAgentMention("@claude fix it\nnow") == "fix it\nnow")
        #expect(withoutAgentMention("@someone else") == "@someone else")
    }

    @Test func aPhotoAloneStillHasABody() throws {
        let photo = PastedImage(name: "photo.jpg", mimeType: "image/jpeg", data: Data([0xff, 0xd8]))
        let send = ProjectChatSend(body: "", settings: settings, images: [photo])
        #expect(send.body == "@claude")
        let json = try JSON(encoding: send)
        #expect(json["images"]?.array?.first?["dataUrl"]?.string == "data:image/jpeg;base64,/9g=")
        #expect(try JSON(encoding: ProjectChatSend(body: "x", settings: settings))["images"] == nil)
    }

    @Test func everyPhotoGoesWithTheSameMessage() throws {
        let photos = (1...10).map { PastedImage(name: "photo-\($0).jpg", mimeType: "image/jpeg", data: Data([0xff, 0xd8])) }
        let send = ProjectChatSend(body: "Review these", settings: settings, images: photos)
        #expect(try JSON(encoding: send)["images"]?.array?.count == 10)
    }
}
