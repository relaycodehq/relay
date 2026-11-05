package dev.relay.android.features.thread.logic

// Colours and cursor moves (CSI), window titles and links (OSC, ended by BEL
// or ESC \), and two-byte escapes like ESC 7 or ESC ( B. As src/lib/terminal-text.ts.
private val terminalCodes =
    Regex("\u001b(?:\\[[0-?]*[ -/]*[@-~]|\\][^\u0007\u001b]*(?:\u0007|\u001b\\\\)?|[ -/]*[0-~])")

/**
 * What a command printed, as plain text: no terminal codes, and a line it
 * redrew with \r, like a progress bar, keeps only its last state.
 */
fun terminalText(output: String): String {
    if ('\u001b' !in output && '\r' !in output) return output
    return output
        .replace(terminalCodes, "")
        .split("\n")
        .joinToString("\n") { line -> line.split("\r").lastOrNull { it.isNotEmpty() } ?: "" }
}
