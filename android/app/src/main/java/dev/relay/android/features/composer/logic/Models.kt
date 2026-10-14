package dev.relay.android.features.composer.logic

import dev.relay.android.remote.model.ModelChoice

// shared/settings.ts (efforts, Claude windows) and shared/model-fit.ts.

val reasoningEfforts = listOf("", "none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra")

private val effortLabels = mapOf(
    "none" to "None", "minimal" to "Minimal", "low" to "Low", "medium" to "Medium",
    "high" to "High", "xhigh" to "Extra high", "max" to "Max", "ultra" to "Ultra",
)

/** The phone's label: "" is "Default". */
fun effortLabel(effort: String) = if (effort.isEmpty()) "Default" else effortLabels[effort] ?: effort

private val common = listOf("low", "medium", "high", "xhigh")

/** Offered until Codex lists its models, and whenever it can't. */
val fallbackCodexModels = listOf(
    AgentModel("gpt-6-astra", "GPT-6-Astra", efforts = common + listOf("max", "ultra"), legacy = false),
    AgentModel("gpt-6-sol", "GPT-6-Sol", efforts = common + listOf("max", "ultra"), legacy = false),
    AgentModel("gpt-6-luna", "GPT-6-Luna", efforts = common + listOf("max"), legacy = false),
    AgentModel("gpt-5.6-sol", "GPT-5.6-Sol", efforts = common + listOf("max", "ultra"), legacy = false),
    AgentModel("gpt-5.6-terra", "GPT-5.6-Terra", efforts = common + listOf("max", "ultra"), legacy = false),
    AgentModel("gpt-5.6-luna", "GPT-5.6-Luna", efforts = common + listOf("max"), legacy = false),
    AgentModel("gpt-5.5", "GPT-5.5", efforts = common, legacy = true),
)

/** A model Codex didn't list (custom, or the list failed) offers every level. */
fun reasoningEffortsFor(model: String, listed: List<AgentModel>? = null): List<String> =
    ((listed ?: fallbackCodexModels).find { it.id == model } ?: fallbackCodexModels.find { it.id == model })?.efforts
        ?: reasoningEfforts.filter { it.isNotEmpty() }

val claudeEfforts = listOf("low", "medium", "high", "xhigh", "max")

fun claudeContextWindow(model: String) = if (model.endsWith("[1m]")) "1m" else "200k"

fun withClaudeContextWindow(model: String, window: String) =
    model.removeSuffix("[1m]") + if (window == "1m") "[1m]" else ""

/** The listed model an id refers to, whichever context window it asks for. */
fun findClaudeModel(models: List<AgentModel>?, id: String): AgentModel? {
    if (models == null || id.isEmpty()) return null
    val bare = withClaudeContextWindow(id, "200k")
    models.find { it.id == id }?.let { return it }
    models.find { withClaudeContextWindow(it.id, "200k") == bare }?.let { return it }
    val aliases = models.filter { it.resolved != null && withClaudeContextWindow(it.resolved, "200k") == bare }
    return aliases.find { claudeContextWindow(it.id) == claudeContextWindow(id) } ?: aliases.firstOrNull()
}

fun claudeEffortsFor(models: List<AgentModel>?, id: String) = findClaudeModel(models, id)?.efforts ?: claudeEfforts

/** Fast stays on only for agents that have it. */
fun fastFor(provider: String, fast: Boolean) = agentInfo(provider)?.fast == true && fast

fun supportsFast(provider: String, model: String, models: List<AgentModel>?) =
    provider == "codex" || (provider == "cursor" && models?.find { it.id == model.ifEmpty { "auto" } }?.fast == true)

/** The 200k window is Claude's, and a model with 1M built in asks for none. */
fun windowFor(provider: String, model: String, contextWindow: String?): String? =
    if (provider == "claude" && !contextWindow.isNullOrEmpty() && claudeContextWindow(model) != "1m") contextWindow else null

/** `choice` moved to `model`, which takes `efforts`: one it lacks goes back to Default. */
fun onModel(provider: String, choice: ModelChoice, model: String, efforts: List<String>, models: List<AgentModel>? = null) =
    ModelChoice(
        model = model,
        reasoningEffort = if (choice.reasoningEffort in efforts) choice.reasoningEffort else "",
        fast = fastFor(provider, choice.fast) &&
            (provider != "cursor" || (models == null && model != "") || supportsFast(provider, model, models)),
    )

fun listedModel(provider: String, models: List<AgentModel>?, id: String): AgentModel? =
    if (provider == "claude") findClaudeModel(models, id) else models?.find { it.id == id }

fun modelName(provider: String, models: List<AgentModel>?, id: String) = listedModel(provider, models, id)?.name ?: id

/** A model choice and its window, as a new thread remembers it per agent. */
@kotlinx.serialization.Serializable
data class NewThreadModel(val choice: ModelChoice, val contextWindow: String? = null)

/** Claude on the 200k or 1M window. */
fun onWindow(model: NewThreadModel, size: String): NewThreadModel =
    if (size == "200k") NewThreadModel(model.choice.copy(model = withClaudeContextWindow(model.choice.model, "200k")), "200k")
    else NewThreadModel(
        model.choice.copy(model = if (model.choice.model.isEmpty()) "" else withClaudeContextWindow(model.choice.model, "1m")),
        null,
    )

/** The efforts an agent's model takes. */
fun modelEfforts(provider: String, model: String, catalogs: ModelCatalogs): List<String> {
    val models = catalogs[provider]
    return when (provider) {
        "codex" -> reasoningEffortsFor(model, models)
        "claude" -> claudeEffortsFor(models, model)
        else -> models?.find { it.id == model }?.efforts ?: emptyList()
    }
}
