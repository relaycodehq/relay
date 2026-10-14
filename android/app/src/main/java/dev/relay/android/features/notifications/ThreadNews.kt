package dev.relay.android.features.notifications

import dev.relay.android.remote.model.RemoteChatSummary
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.time.temporal.ChronoUnit
import java.util.Locale

/**
 * shared/thread-news.ts: what a phone tells you about while it's in your
 * pocket: a thread that finished, failed or asked you something since the
 * last list, worded for a notification.
 */
data class ThreadNews(val chatId: String, val kind: Kind, val title: String, val body: String) {
    enum class Kind { Waiting, Finished, Failed }
}

/** A thread's latest answer in the main conversation, as its message events left it. */
data class LastAnswer(val status: String, val body: String, val error: String?, val provider: String)

private const val PREVIEW_LENGTH = 240

/** Threads that moved from one list to the next. A new thread isn't news, nor one read where it happened. */
fun threadNews(
    before: Map<String, RemoteChatSummary>,
    now: List<RemoteChatSummary>,
    answers: Map<String, LastAnswer>,
    at: Long = System.currentTimeMillis(),
    zone: ZoneId = ZoneId.systemDefault(),
): List<ThreadNews> {
    val news = mutableListOf<ThreadNews>()
    for (c in now) {
        val was = before[c.id] ?: continue
        if (read(c)) continue
        val agent = c.provider?.let(::agentName) ?: "The agent"
        if (c.waiting == true && was.waiting != true) {
            news += ThreadNews(c.id, ThreadNews.Kind.Waiting, c.title, "$agent needs you")
            continue
        }
        val limit = c.limitResume
        if (limit != null && was.limitResume == null) {
            val who = agentName(limit.provider)
            news += ThreadNews(
                c.id, ThreadNews.Kind.Failed, c.title,
                if (limit.off == true) "$who hit its usage limit"
                else "$who hit its usage limit · resumes the answer at ${wakeLabel(limit.at, at, zone)}",
            )
            continue
        }
        if (was.running != true || c.running == true) continue
        // Snoozed: it comes back by itself when you said.
        if ((c.snoozedUntil ?: 0) > at) continue
        val answer = answers[c.id]
        // An optional question must not hide a failure after the agent kept working.
        if (c.waiting == true && answer?.status != "failed") continue
        // Someone stopped it, so someone knows.
        if (answer?.status == "cancelled") continue
        // Settled while it ran: it finishes out of sight. A failure comes back to Activity.
        if (answer?.status != "failed" && (chatSettled(was) || chatSettled(c))) continue
        news += if (answer?.status == "failed") {
            ThreadNews(
                c.id, ThreadNews.Kind.Failed, c.title,
                if (!answer.error.isNullOrBlank()) agentError(answer.error) else "$agent's answer failed",
            )
        } else {
            ThreadNews(
                c.id, ThreadNews.Kind.Finished, c.title,
                answer?.let { preview(it.body) }?.takeIf { it.isNotEmpty() } ?: "$agent finished",
            )
        }
    }
    return news
}

/** Threads read since the last list, on the computer or another phone, whose notification can go. */
fun threadsRead(before: Map<String, RemoteChatSummary>, now: List<RemoteChatSummary>): List<String> =
    now.filter { read(it) && !read(before[it.id]) }.map { it.id }

private fun read(c: RemoteChatSummary?): Boolean { val seen = c?.seenAt ?: return false; return seen != 0L && seen >= c.updated }

/** shared/chat-activity.ts chatSettled. */
fun chatSettled(c: RemoteChatSummary): Boolean {
    val settledAt = c.settledAt
    if (c.waiting == true || settledAt == null) return false
    if (c.settleWhenDone != null) return true
    return c.running != true && settledAt >= c.updated
}

private val codeBlock = Regex("```[^\\n]*\\n[\\s\\S]*?(```|$)")
private val image = Regex("!\\[([^\\]]*)\\]\\([^)]*\\)")
private val link = Regex("\\[([^\\]]+)\\]\\([^)]*\\)")
private val headingLine = Regex("^\\s{0,3}#{1,6}\\s+(.*?)\\s*#*\\s*$(?=\\n\\s*\\S)", RegexOption.MULTILINE)
private val lineMark = Regex("^\\s{0,3}(#{1,6}\\s+|>\\s?|[-*+]\\s+|\\d+[.)]\\s+)", RegexOption.MULTILINE)
private val emphasis = Regex("(\\*\\*|__|\\*|_|~~|`)(?=\\S)([^\\n]*?\\S)\\1")
private val spaces = Regex("\\s+")
private val endsSentence = Regex("[.:!?]$")

/** The start of an answer as plain words. A heading runs into what follows it, so it gets a colon. */
fun preview(markdown: String, length: Int = PREVIEW_LENGTH): String {
    var text = markdown
        .replace(codeBlock, " ")
        .replace(image, "$1")
        .replace(link, "$1")
    text = headingLine.replace(text) { m ->
        val heading = m.groupValues[1]
        if (endsSentence.containsMatchIn(heading)) heading else "$heading:"
    }
    text = text.replace(lineMark, "").replace(emphasis, "$2").replace(spaces, " ").trim()
    // Lengths count UTF-16 units, as JS does.
    return if (text.length > length) text.substring(0, length - 1).trimEnd() + "…" else text
}

private val agentNames = mapOf(
    "codex" to "Codex",
    "claude" to "Claude",
    "opencode" to "OpenCode",
    "cursor" to "Cursor",
    "muse" to "Muse",
    "amp" to "Amp",
    "antigravity" to "Antigravity",
)

/** shared/agents.ts agentName; registry agents ("acp:<id>") read as their id. */
fun agentName(provider: String): String {
    agentNames[provider]?.let { return it }
    if (provider.startsWith("acp:"))
        return provider.removePrefix("acp:").split('-').filter { it.isNotEmpty() }
            .joinToString(" ") { w -> w.replaceFirstChar { it.titlecase(Locale.ROOT) } }
    return provider
}

private const val DETAILS = "\n\nTechnical details:\n"
private val missingCli = Regex("^(\\S+) was not found\\. Install it in Settings → AI models → Agents, or put it on PATH\\.$")
private val unsupportedModel = Regex(
    "^The ['\"]([^'\"]+)['\"] model is not supported when using Codex with a ChatGPT account\\.?$",
    RegexOption.IGNORE_CASE,
)
private val json = Json

/** shared/agent-error.ts agentError, the message only. */
fun agentError(error: String): String {
    val at = error.indexOf(DETAILS)
    if (at >= 0) return agentError(error.substring(0, at))
    val raw = error.trim()
    missingCli.find(raw)?.let { return "${it.groupValues[1]} isn't installed on this computer." }
    var message = raw
    val start = raw.indexOf('{')
    if (start >= 0) {
        try {
            val value = json.parseToJsonElement(raw.substring(start))
            message = envelopeMessage(value) ?: "The agent couldn't finish this answer."
        } catch (_: Exception) {
            // Plain text and malformed responses stay readable verbatim.
        }
    }
    unsupportedModel.find(message)?.let { return "${it.groupValues[1]} isn't available with your ChatGPT account." }
    return message
}

private fun envelopeMessage(value: JsonElement?): String? = when (value) {
    is JsonPrimitive -> if (value.isString) value.content.trim().ifEmpty { null } else null
    is JsonObject -> envelopeMessage(value["error"])
        ?: (value["message"] as? JsonPrimitive)?.takeIf { it.isString }?.content?.trim()?.ifEmpty { null }
    else -> null
}

/** shared/chat-activity.ts wakeLabel: "17:30", "tomorrow 9:00", "Mon 9:00", "Oct 3, 9:00". */
fun wakeLabel(until: Long, now: Long, zone: ZoneId = ZoneId.systemDefault(), locale: Locale = Locale.getDefault()): String {
    val wake = Instant.ofEpochMilli(until).atZone(zone)
    val ahead = ChronoUnit.DAYS.between(Instant.ofEpochMilli(now).atZone(zone).toLocalDate(), wake.toLocalDate())
    val day = when {
        ahead <= 0 -> ""
        ahead == 1L -> "tomorrow "
        ahead < 7 -> DateTimeFormatter.ofPattern("EEE", locale).format(wake) + " "
        else -> DateTimeFormatter.ofPattern("MMM d", locale).format(wake) + ", "
    }
    return day + DateTimeFormatter.ofLocalizedTime(FormatStyle.SHORT).withLocale(locale).format(wake)
}
