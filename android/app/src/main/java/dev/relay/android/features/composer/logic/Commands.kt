package dev.relay.android.features.composer.logic

// shared/commands.ts and shared/composer-commands.ts.

data class RelayCommandInfo(val name: String, val description: String, val args: String? = null)

val relayCommands = listOf(
    RelayCommandInfo("openpr", "Open this branch’s PR, or create one"),
    RelayCommandInfo("changes", "Review local uncommitted changes"),
    RelayCommandInfo("files", "Browse project files"),
    RelayCommandInfo("new", "Start a new thread in this project"),
    RelayCommandInfo("clear", "Start a new thread with empty context"),
    RelayCommandInfo("compact", "Summarize earlier turns to free context", "[instructions]"),
    RelayCommandInfo("context", "Show context window usage"),
    RelayCommandInfo("goal", "Keep the agent working until a goal is met", "<objective|pause|resume|clear>"),
    RelayCommandInfo("reload", "Restart the agent on this conversation to load new skills, plugins and instructions"),
    RelayCommandInfo("btw", "Ask a side question without interrupting the agent", "<question>"),
    RelayCommandInfo(
        "provider",
        "Switch between ${agentProviders.map(::agentName).joinToString(", ")} and messages only",
        "<agent>",
    ),
    RelayCommandInfo("model", "Choose the model", "<model>"),
    RelayCommandInfo("effort", "Set reasoning effort", "<level>"),
    RelayCommandInfo("plan", "Toggle plan mode", "[on|off]"),
    RelayCommandInfo("permissions", "Set what the agent may do without asking", "<mode>"),
    RelayCommandInfo("fast", "Toggle Fast mode", "[on|off]"),
    RelayCommandInfo("add-dir", "Let the agent reach another folder in this thread", "<folder>"),
    RelayCommandInfo("resume", "Continue a Claude Code or Codex session from a terminal", "<session>"),
)

val composerCommands = listOf("provider", "model", "effort", "plan", "permissions", "fast")

fun isComposerCommand(name: String) = name in composerCommands

const val asideNeedsAnswer = "Ask the agent something first, then ask on the side."

val sideAgentsText = sideProviders.map(::agentName).joinToString(", ").replace(Regex(", ([^,]*)$"), " or $1")

/** Why `provider` can't take a `/btw`, or null when it can. */
fun sideRefusal(provider: String): String? =
    if (agentInfo(provider)?.side == true) null
    else "${agentName(provider)} can't answer beside the thread. Pick $sideAgentsText to ask a side question."

data class ParsedCommand(val name: String, val args: String)

private val commandPattern = Regex("^/([a-z]+(?:-[a-z]+)*)(?:\\s+([\\s\\S]*))?$", RegexOption.IGNORE_CASE)

/** Relay commands take arguments only where they declare them. */
fun relayCommand(text: String): ParsedCommand? {
    val m = commandPattern.find(text.trim())
    val command = relayCommands.find { it.name == m?.groupValues?.get(1)?.lowercase() } ?: return null
    val args = m?.groups?.get(2)?.value?.trim() ?: ""
    if (args.isNotEmpty() && command.args == null) return null
    return ParsedCommand(command.name, args)
}

/** A leading `/` names a command, unless it opens a path like `/Users/me/clip.mp4`. */
fun startsWithCommand(text: String) = Regex("^/[^\\s/]*(?:\\s|$)").containsMatchIn(text.trim())

data class CommandTrigger(val prefix: Char, val query: String, val start: Int, val end: Int, val inline: Boolean)

/** Slash actions start a message, composer commands may follow text, `$skill` goes anywhere. */
fun commandTrigger(text: String, cursor: Int = text.length): CommandTrigger? {
    val before = text.substring(0, cursor.coerceIn(0, text.length))
    val m = Regex("(^|\\s)([$/])(\\S*)$").find(before) ?: return null
    val prefix = m.groupValues[2][0]
    val query = m.groupValues[3]
    if (prefix == '/' && query.contains('/')) return null
    val start = m.range.first + m.groupValues[1].length
    return CommandTrigger(prefix, query, start, before.length, prefix == '/' && before.substring(0, start).isNotBlank())
}

/** A command an agent offers (skills, prompts), as the desktop lists it. */
@kotlinx.serialization.Serializable
data class ProviderCommand(
    val name: String,
    val description: String = "",
    val displayName: String? = null,
    val source: String? = null,
    val argumentHint: String? = null,
    val skill: Boolean? = null,
)

/** What a composer command changes. */
sealed interface ComposerChange {
    data class Provider(val provider: String) : ComposerChange
    /** The model goes to `provider`, which becomes the recipient; "" is Default. */
    data class Model(val provider: String, val model: String) : ComposerChange
    data class Effort(val reasoningEffort: String) : ComposerChange
    data class Permissions(val runtimeMode: String) : ComposerChange
    data class Plan(val plan: Boolean) : ComposerChange
    data class Fast(val fast: Boolean) : ComposerChange
}

data class ModelOption(val provider: String, val value: String, val description: String)

/** Every model /model can switch to: the recipient's, its Default, then the rest. */
fun modelCommandOptions(recipient: String, catalogs: ModelCatalogs, defaultNames: Map<String, String> = emptyMap()): List<ModelOption> {
    val listed = agentProviders.flatMap { provider ->
        val models = catalogs[provider].orEmpty()
        models.flatMap { m ->
            val long = withClaudeContextWindow(m.id, "1m")
            listOf(ModelOption(provider, m.id, m.name)) +
                if (m.longContext == true && models.none { it.id == long }) listOf(ModelOption(provider, long, "${m.name} · 1M context"))
                else emptyList()
        }
    }
    val default = if (recipient == "message") emptyList() else listOf(
        ModelOption(
            recipient, "default",
            defaultNames[recipient]?.let { "${agentName(recipient)} default · $it" } ?: "${agentName(recipient)} default",
        ),
    )
    return listed.filter { it.provider == recipient } + default + listed.filter { it.provider != recipient }
}

data class CommandSettings(
    val recipient: String,
    /** What /provider may switch to. */
    val targets: List<String>,
    /** The recipient's model; "" is its Default. */
    val model: String,
    val fast: Boolean,
    val plan: Boolean,
    val catalogs: ModelCatalogs,
    val defaultNames: Map<String, String> = emptyMap(),
)

private val modelSchema = Regex("^[a-zA-Z0-9][a-zA-Z0-9._:/\\[\\]@~+-]*$")
private const val noAgent = "Choose an agent before changing agent settings."

sealed interface CommandResult {
    data class Change(val change: ComposerChange) : CommandResult
    data class Error(val message: String) : CommandResult
}

/** A composer command's change to `settings`, or why it can't make one. */
fun composerCommand(command: String, args: String, settings: CommandSettings): CommandResult {
    val value = args.lowercase()
    val recipient = settings.recipient
    fun ok(c: ComposerChange) = CommandResult.Change(c)
    fun err(m: String) = CommandResult.Error(m)
    if (command == "provider") {
        val provider = settings.targets.find { it == value }
        return if (provider != null) ok(ComposerChange.Provider(provider)) else err("Choose one of: ${settings.targets.joinToString(", ")}.")
    }
    if (command == "model") {
        val option = modelCommandOptions(recipient, settings.catalogs, settings.defaultNames)
            .find { it.value.lowercase() == value || it.description.lowercase() == value }
        val model = when {
            option != null -> if (option.value == "default") "" else option.value
            args.length <= 160 && modelSchema.matches(args) -> args
            else -> null
        }
        val provider = option?.provider ?: recipient
        if (model == null) return err("Enter a valid model ID.")
        if (provider == "message") return err(noAgent)
        return ok(ComposerChange.Model(provider, model))
    }
    if (recipient == "message") return err(noAgent)
    if (args.isNotEmpty() && (command == "plan" || command == "fast") && value != "on" && value != "off")
        return err("Use /$command on or /$command off.")
    fun toggled(on: Boolean) = when (value) { "on" -> true; "off" -> false; else -> !on }
    when (command) {
        "effort" -> {
            val allowed = listOf("default") + modelEfforts(recipient, settings.model, settings.catalogs)
            if (value !in allowed) return err("Choose one of: ${allowed.joinToString(", ")}.")
            return ok(ComposerChange.Effort(if (value == "default") "" else value))
        }
        "permissions" -> {
            val mode = runtimeModes.find { it.value == value || it.label.lowercase() == value }
                ?: return err("Choose one of: ${runtimeModes.joinToString(", ") { it.value }}.")
            return ok(ComposerChange.Permissions(mode.value))
        }
        "plan" -> return ok(ComposerChange.Plan(toggled(settings.plan)))
    }
    val fast = toggled(settings.fast)
    if (!supportsFast(recipient, settings.model, settings.catalogs[recipient]) && !(recipient == "cursor" && !fast))
        return err(
            if (recipient == "cursor") "Fast mode is not available for this Cursor model."
            else "Fast mode is only available for Codex and supported Cursor models.",
        )
    return ok(ComposerChange.Fast(fast))
}
