package dev.relay.android.features.thread.logic

import dev.relay.android.remote.model.ChatMessage
import dev.relay.android.remote.model.WorktreeCommandRun
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.contentOrNull
import java.text.NumberFormat
import java.util.Locale
import kotlin.math.abs
import kotlin.math.roundToLong

// Small wording helpers from shared/ (agents, tokens, thread-cost, usage, session-reload,
// worktree-command, remote-compose, thread-news), as the phone shows them.

fun agentName(provider: String?): String = when (provider ?: "claude") {
    "codex" -> "Codex"
    "claude" -> "Claude"
    "opencode" -> "OpenCode"
    "cursor" -> "Cursor"
    "muse" -> "Muse"
    "amp" -> "Amp"
    "antigravity" -> "Antigravity"
    else -> provider ?: "Claude"
}

private fun oneDecimal(value: Double) = String.format(Locale.US, "%.1f", value).removeSuffix(".0")

fun formatTokens(value: Double): String = when {
    value < 1_000 -> "${value.roundToLong()}"
    value < 10_000 -> "${oneDecimal(value / 1_000)}k"
    value < 1_000_000 -> "${(value / 1_000).roundToLong()}k"
    else -> "${oneDecimal(value / 1_000_000)}M"
}

/** "281k → 8.9k tokens", or as much of it as the agent reported. */
fun compactedTokens(before: Double?, after: Double?): String {
    // A reading taken during the compaction itself is no smaller than before.
    val a = after?.takeIf { it != 0.0 && !(before != null && before != 0.0 && it >= before) }
    val b = before?.takeIf { it != 0.0 }
    return when {
        b != null && a != null -> "${formatTokens(b)} → ${formatTokens(a)} tokens"
        b != null -> "from ${formatTokens(b)} tokens"
        a != null -> "to ${formatTokens(a)} tokens"
        else -> ""
    }
}

fun formatDollars(value: Double): String {
    val v = abs(value)
    val digits = if (v >= 100 || v == Math.floor(v)) 0 else 2
    val f = NumberFormat.getNumberInstance(Locale.US).apply {
        minimumFractionDigits = digits
        maximumFractionDigits = digits
    }
    return "${if (value < 0) "−" else ""}$${f.format(v)}"
}

fun formatCost(usd: Double) = if (usd < 0.01) "<$0.01" else formatDollars(usd)

/** An answer's speed worth showing (tokens a second), or null under 50 tokens. */
fun answerSpeed(streamed: JsonObject?): Long? {
    val output = streamed?.get("output")?.jsonPrimitive?.contentOrNull?.toDoubleOrNull() ?: return null
    val ms = streamed["ms"]?.jsonPrimitive?.contentOrNull?.toDoubleOrNull() ?: return null
    if (output < 50 || ms <= 0) return null
    return (output * 1000 / ms).roundToLong()
}

fun streamedOutput(streamed: JsonObject?): Double? =
    streamed?.get("output")?.jsonPrimitive?.contentOrNull?.toDoubleOrNull()

private fun names(reload: JsonObject, key: String, side: String): List<String> =
    ((reload[key] as? JsonObject)?.get(side) as? JsonArray)?.mapNotNull { it.jsonPrimitive.contentOrNull } ?: emptyList()

private fun count(n: Int, word: String) = "$n $word${if (n == 1) "" else "s"}"

/** "Session reloaded · picked up 2 new skills · 1 agent gone", or "Reloading session…" while live. */
fun reloadNote(reload: JsonObject, live: Boolean): String {
    if (live) return "Reloading session…"
    val kinds = listOf("skills" to "skill", "agents" to "agent")
    val added = kinds.mapNotNull { (k, w) -> names(reload, k, "added").size.takeIf { it > 0 }?.let { count(it, "new $w") } }
    val removed = kinds.mapNotNull { (k, w) -> names(reload, k, "removed").size.takeIf { it > 0 }?.let { count(it, w) } }
    return buildList {
        add("Session reloaded")
        if (added.isNotEmpty()) add("picked up ${added.joinToString(" and ")}")
        if (removed.isNotEmpty()) add("${removed.joinToString(" and ")} gone")
    }.joinToString(" · ")
}

/** "Setting up the worktree…", "Worktree setup failed (exit 1)" and the like. */
fun worktreeCommandNote(run: WorktreeCommandRun, status: String): String {
    val setup = run.kind == "setup"
    if (status == "streaming") return if (setup) "Setting up the worktree…" else "Tearing down the worktree…"
    if (status == "complete") return if (setup) "Worktree set up" else "Worktree torn down"
    val what = if (setup) "Worktree setup" else "Worktree teardown"
    if (run.stopped == "timeout") return "$what timed out"
    if (status == "cancelled" || run.stopped == "cancelled") return "$what stopped"
    return if (run.exitCode != null && run.exitCode > 0) "$what failed (exit ${run.exitCode})" else "$what failed"
}

fun copiedNote(copied: List<String>) = "Copied from the project folder: ${copied.joinToString(", ")}"

fun setupCanRerun(m: ChatMessage) =
    m.worktreeCommand?.kind == "setup" && (m.status == "failed" || m.status == "cancelled")

fun latestSetup(messages: List<ChatMessage>) = messages.lastOrNull { it.worktreeCommand?.kind == "setup" }

private val agentMention = Regex("^@(?:codex|claude|opencode|cursor|muse|amp|antigravity)(?=\\s|$)\\s*", RegexOption.IGNORE_CASE)

/** A send's text without the `@agent` it leads with. */
fun withoutMention(body: String) = body.replace(agentMention, "")

/** The start of an answer as plain words: no fences, marks or link targets. */
fun preview(markdown: String, length: Int = 240): String {
    val text = markdown
        .replace(Regex("```[^\\n]*\\n[\\s\\S]*?(```|$)"), " ")
        .replace(Regex("!\\[([^\\]]*)\\]\\([^)]*\\)"), "$1")
        .replace(Regex("\\[([^\\]]+)\\]\\([^)]*\\)"), "$1")
        .replace(Regex("(?m)^\\s{0,3}#{1,6}\\s+(.*?)\\s*#*\\s*$(?=\\n\\s*\\S)")) {
            val heading = it.groupValues[1]
            if (Regex("[.:!?]$").containsMatchIn(heading)) heading else "$heading:"
        }
        .replace(Regex("(?m)^\\s{0,3}(#{1,6}\\s+|>\\s?|[-*+]\\s+|\\d+[.)]\\s+)"), "")
        .replace(Regex("(\\*\\*|__|\\*|_|~~|`)(?=\\S)([^\\n]*?\\S)\\1"), "$2")
        .replace(Regex("\\s+"), " ")
        .trim()
    return if (text.length > length) "${text.take(length - 1).trimEnd()}…" else text
}

/** Compact age: "now", "4m", "3h", "2d", "5w". */
fun shortAge(then: Long, now: Long): String {
    val minutes = maxOf(0L, (now - then) / 60_000)
    if (minutes < 1) return "now"
    if (minutes < 60) return "${minutes}m"
    val hours = minutes / 60
    if (hours < 24) return "${hours}h"
    val days = hours / 24
    if (days < 7) return "${days}d"
    return "${days / 7}w"
}
