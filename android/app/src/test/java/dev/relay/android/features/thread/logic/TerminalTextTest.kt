package dev.relay.android.features.thread.logic

import org.junit.Assert.assertEquals
import org.junit.Test

// Cases from src/lib/terminal-text.test.ts.
class TerminalTextTest {
    @Test fun dropsTerminalCodes() {
        val cases = listOf(
            "\u001b[1m\u001b[31mFAIL\u001b[39m\u001b[22m a.test.ts" to "FAIL a.test.ts",
            "\u001b[2K\u001b[1A\u001b[2Kdone" to "done",
            "\u001b]0;npm test\u0007ok" to "ok",
            "see \u001b]8;;https://x.dev\u001b\\docs\u001b]8;;\u001b\\ now" to "see docs now",
            "\u001b7\u001b8\u001b(Bok" to "ok",
            "\u001b[>5u\u001b[<uok" to "ok",
            "10%\r50%\r100%\nnext" to "100%\nnext",
            "a\r\nb\r\n" to "a\nb\n",
        )
        for ((output, text) in cases) assertEquals(text, terminalText(output))
    }

    @Test fun leavesPlainOutputAsItIsIndentAndAll() {
        assertEquals(" M src/a.ts\n?? b.ts\n", terminalText(" M src/a.ts\n?? b.ts\n"))
    }
}
