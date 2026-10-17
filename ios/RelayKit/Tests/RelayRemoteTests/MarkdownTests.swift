import Foundation
import RelayMarkdown
import Testing

struct MarkdownTests {
    @Test func blocksComeOutInOrderWithTheirParts() {
        let md = """
            ## Plan
            Run `npm test`, **then** [ship](https://relaycode.io).

            ```swift title
            let x = 1
            ```

            - [x] done
            - [ ] next

            3. three
            4. four

            | a | b |
            |---|---|
            | 1 | ~~2~~ |

            > quoted
            ---
            """
        let blocks = markdownBlocks(md)
        #expect(blocks.count == 8)
        guard case .heading(2, let title) = blocks[0] else { Issue.record("\(blocks[0])"); return }
        #expect(String(title.characters) == "Plan")
        guard case .paragraph(let p) = blocks[1] else { Issue.record("\(blocks[1])"); return }
        #expect(String(p.characters) == "Run npm test, then ship.")
        #expect(p.runs.contains { $0.inlinePresentationIntent == .code && String(p[$0.range].characters) == "npm test" })
        #expect(p.runs.contains { $0.link?.absoluteString == "https://relaycode.io" })
        #expect(blocks[2] == .code(language: "swift", text: "let x = 1"))
        guard case .list(false, _, let tasks) = blocks[3], case .list(true, 3, let numbered) = blocks[4] else {
            Issue.record("\(blocks[3]) \(blocks[4])")
            return
        }
        #expect(tasks.map(\.checked) == [true, false])
        #expect(numbered.count == 2)
        guard case .table(let header, let rows) = blocks[5] else { Issue.record("\(blocks[5])"); return }
        #expect(header.map { String($0.characters) } == ["a", "b"])
        #expect(rows[0][1].runs.first?.inlinePresentationIntent == .strikethrough)
        #expect(blocks[7] == .rule)
    }

    @Test func localPicturesFollowTheirParagraph() {
        let blocks = markdownBlocks("Before ![shot](out/a.png) after ![](https://x.dev/r.png).")
        guard case .figure(let text, let whole, let images) = blocks.first else { Issue.record("\(blocks)"); return }
        #expect(String(text.characters) == "Before after https://x.dev/r.png.")
        #expect(String(whole.characters) == "Before shot after https://x.dev/r.png.")
        #expect(images == [MdImage(source: "out/a.png", alt: "shot")])
        guard case .paragraph = markdownBlocks("Only ![](https://x.dev/r.png)").first else { Issue.record("web"); return }
    }

    @Test func bareAddressesAreLinksAsOnAndroid() {
        let md = "It is at http://localhost:5173/about. Or (see www.relaycode.io/docs), mail hi@relaycode.io; not `http://x.dev` or [a](https://a.dev)."
        guard case .paragraph(let p) = markdownBlocks(md).first else { Issue.record("not a paragraph"); return }
        let links = p.runs.compactMap { run in run.link.map { (String(p[run.range].characters), $0.absoluteString) } }
        #expect(links.map(\.0) == ["http://localhost:5173/about", "www.relaycode.io/docs", "hi@relaycode.io", "a"])
        #expect(links.map(\.1) == ["http://localhost:5173/about", "http://www.relaycode.io/docs", "mailto:hi@relaycode.io", "https://a.dev"])
        #expect(String(p.characters) == "It is at http://localhost:5173/about. Or (see www.relaycode.io/docs), mail hi@relaycode.io; not http://x.dev or a.")
    }

    @Test func anUnclosedFenceWhileStreamingIsStillCode() {
        #expect(markdownBlocks("Look:\n\n```ts\nconst a = 1") == [.paragraph("Look:"), .code(language: "ts", text: "const a = 1")])
    }
}
