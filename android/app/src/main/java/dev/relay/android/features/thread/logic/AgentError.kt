package dev.relay.android.features.thread.logic

import dev.relay.android.remote.model.RemoteJson
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

// shared/agent-error.ts: an answer's error as the reader should see it.

data class AgentErrorShown(
    val message: String,
    val hint: String? = null,
    val details: String? = null,
    /** The agent's program isn't on this computer; going again won't help. */
    val notInstalled: Boolean = false,
)

private const val DETAILS = "\n\nTechnical details:\n"
// Older desktops said "AI models"; their stored errors still reach the phone.
private val MISSING = Regex("^(\\S+) was not found\\. Install it in Settings → AI (?:models|& agents) → Agents, or put it on PATH\\.$")
private val UNSUPPORTED = Regex(
    "^The ['\"]([^'\"]+)['\"] model is not supported when using Codex with a ChatGPT account\\.?$",
    RegexOption.IGNORE_CASE,
)

private fun envelopeMessage(value: JsonElement?): String? = when (value) {
    is JsonPrimitive -> if (value.isString) value.content.trim().ifEmpty { null } else null
    is JsonObject -> envelopeMessage(value["error"])
        ?: (value["message"] as? JsonPrimitive)?.takeIf { it.isString }?.content?.trim()?.ifEmpty { null }
    else -> null
}

fun agentError(error: String): AgentErrorShown {
    val at = error.indexOf(DETAILS)
    if (at >= 0) return agentError(error.substring(0, at)).copy(details = error.substring(at + DETAILS.length))
    val raw = error.trim()
    MISSING.find(raw)?.let {
        return AgentErrorShown(
            "${it.groupValues[1]} isn't installed on this computer.",
            "Set it up in Settings → AI & agents → Agents, or put it on PATH, then send again.",
            notInstalled = true,
        )
    }
    var message = raw
    var structured = false
    val start = raw.indexOf('{')
    if (start >= 0) {
        try {
            val value = RemoteJson.parseToJsonElement(raw.substring(start))
            message = envelopeMessage(value) ?: "The agent couldn't finish this answer."
            structured = true
        } catch (_: Exception) {
        }
    }
    UNSUPPORTED.find(message)?.let {
        return AgentErrorShown(
            "${it.groupValues[1]} isn't available with your ChatGPT account.",
            "Choose a different model in the composer, then resume the answer.",
            details = error,
        )
    }
    return AgentErrorShown(message, details = if (structured) error else null)
}
