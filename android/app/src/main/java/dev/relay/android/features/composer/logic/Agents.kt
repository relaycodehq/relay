package dev.relay.android.features.composer.logic

import kotlinx.serialization.Serializable

/** shared/agents.ts: what each agent offers, as far as the composer needs it. */
data class AgentInfo(
    val name: String,
    val defaultModel: String,
    val fast: Boolean,
    val skills: Boolean,
    val commandsAlone: Boolean,
    val side: Boolean,
    val usage: Boolean,
    val modelGroups: Boolean,
)

val agentProviders = listOf("codex", "claude", "opencode", "cursor", "muse", "amp", "antigravity")

private fun info(name: String, fast: Boolean = false, skills: Boolean = false, alone: Boolean = true, side: Boolean = false, usage: Boolean = false, groups: Boolean = false) =
    AgentInfo(name, "$name default", fast, skills, alone, side, usage, groups)

private val builtin = mapOf(
    "codex" to info("Codex", fast = true, skills = true, alone = false, side = true, usage = true),
    "claude" to info("Claude", side = true, usage = true),
    "opencode" to info("OpenCode", side = true, groups = true),
    "cursor" to info("Cursor", fast = true, groups = true),
    "muse" to info("Muse", side = true, usage = true),
    "amp" to info("Amp"),
    "antigravity" to info("Antigravity"),
)

private val registryId = Regex("^[a-z0-9][a-z0-9-]*$")

fun isAgentProvider(value: String?): Boolean =
    value != null && (value in builtin || (value.startsWith("acp:") && registryId.matches(value.substring(4))))

/** `factory-droid` as "Factory Droid", for a registry agent whose name hasn't arrived. */
private fun nameFromId(id: String) =
    id.split('-').joinToString(" ") { part -> part.replaceFirstChar { it.uppercase() } }

fun agentInfo(provider: String): AgentInfo? = builtin[provider]
    ?: if (isAgentProvider(provider)) info(nameFromId(provider.substring(4))) else null

fun agentName(provider: String) = agentInfo(provider)?.name ?: provider

fun reportsUsage(provider: String) = builtin[provider]?.usage == true

/**
 * shared/agent-prefs.ts: what a picker offers, in Settings' order (the ones it
 * hasn't placed after, in Relay's), without those switched off except [keep].
 */
fun offeredAgents(order: List<String>, off: List<String>, keep: String? = null): List<String> {
    val placed = order.filter { it in agentProviders }.distinct()
    return (placed + agentProviders.filter { it !in placed }).filter { it !in off || it == keep }
}

val sideProviders = agentProviders.filter { builtin[it]!!.side }

/** `@codex`, `@claude`, … at the start of a message. */
val agentMentionPattern = Regex("^@(${agentProviders.joinToString("|")})(?=\\s|$)\\s*", RegexOption.IGNORE_CASE)

data class AgentMention(val provider: String, val question: String)

fun agentMention(text: String): AgentMention? {
    val trimmed = text.trim()
    val m = agentMentionPattern.find(trimmed) ?: return null
    return AgentMention(m.groupValues[1].lowercase(), trimmed.substring(m.value.length).trim())
}

fun withoutMention(body: String) = agentMentionPattern.replaceFirst(body, "")

/** A model an agent offers, as its CLI or server lists it. */
@Serializable
data class AgentModel(
    val id: String,
    val name: String,
    val description: String = "",
    val efforts: List<String> = emptyList(),
    val fast: Boolean? = null,
    val legacy: Boolean? = null,
    val defaultEffort: String? = null,
    val group: String? = null,
    val contextWindow: Long? = null,
    val resolved: String? = null,
    /** Claude's: also runs with a 1M window. */
    val longContext: Boolean? = null,
)

/** What an agent runs where a thread leaves the model or effort on Default. */
@Serializable
data class AgentDefaults(
    val model: String = "",
    val effort: String = "",
    val efforts: Map<String, String>? = null,
)

typealias ModelCatalogs = Map<String, List<AgentModel>>

/** shared/agent-modes.ts runtimeModes. */
data class RuntimeModeInfo(val value: String, val label: String, val description: String)

val runtimeModes = listOf(
    RuntimeModeInfo("approval-required", "Supervised", "Asks before running commands or changing files."),
    RuntimeModeInfo("auto-accept-edits", "Auto-accept edits", "Edits files freely, asks before anything else."),
    RuntimeModeInfo("auto", "Auto", "The agent's own reviewer clears routine actions; agents without one ask."),
    RuntimeModeInfo("full-access", "Full access", "Runs commands and edits files without asking."),
)

fun modeLabel(mode: String) = runtimeModes.find { it.value == mode }?.label ?: mode
