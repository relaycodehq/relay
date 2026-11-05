import Testing

@testable import RelayRemote

// src/lib/terminal-text.test.ts.

@Test(arguments: [
    ("\u{1b}[1m\u{1b}[31mFAIL\u{1b}[39m\u{1b}[22m a.test.ts", "FAIL a.test.ts"),
    ("\u{1b}[2K\u{1b}[1A\u{1b}[2Kdone", "done"),
    ("\u{1b}]0;npm test\u{07}ok", "ok"),
    ("see \u{1b}]8;;https://x.dev\u{1b}\\docs\u{1b}]8;;\u{1b}\\ now", "see docs now"),
    ("\u{1b}7\u{1b}8\u{1b}(Bok", "ok"),
    ("\u{1b}[>5u\u{1b}[<uok", "ok"),
    ("10%\r50%\r100%\nnext", "100%\nnext"),
    ("a\r\nb\r\n", "a\nb\n"),
])
func dropsTerminalCodesFromCommandOutput(output: String, text: String) {
    #expect(terminalText(output) == text)
}

@Test func leavesPlainOutputAsItIsIndentAndAll() {
    #expect(terminalText(" M src/a.ts\n?? b.ts\n") == " M src/a.ts\n?? b.ts\n")
}
