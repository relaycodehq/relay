package dev.relay.android.features.composer

import dev.relay.android.features.composer.logic.AgentDefaults
import dev.relay.android.features.composer.logic.AgentModel
import dev.relay.android.features.composer.logic.ModelCatalogs
import dev.relay.android.features.composer.logic.NewThreadAI
import dev.relay.android.features.composer.logic.NewThreadModel
import dev.relay.android.features.composer.logic.NewThreadModels
import dev.relay.android.features.composer.logic.ProviderCommand
import dev.relay.android.features.composer.logic.ProviderUsage
import dev.relay.android.features.composer.logic.newThreadSettingsFrom
import dev.relay.android.remote.model.ResumeSettings
import dev.relay.android.remote.client.RemoteClient
import dev.relay.android.remote.model.RemoteJson
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.encodeToJsonElement
import kotlinx.serialization.json.jsonObject
import java.util.concurrent.ConcurrentHashMap

// The desktop calls the composer and a new thread make, typed. Each throws
// what RemoteClient.desktop does.

private fun p(value: String?): JsonElement = value?.let(::JsonPrimitive) ?: JsonNull
private inline fun <reified T> JsonElement.to(): T = RemoteJson.decodeFromJsonElement(this)

suspend fun RemoteClient.agentModels(provider: String): List<AgentModel> =
    desktop("agentModels", listOf(p(provider))).to()

suspend fun RemoteClient.agentDefaults(projectId: String, provider: String): AgentDefaults? =
    desktop("agentDefaults", listOf(p(projectId), p(provider))).takeUnless { it is JsonNull }?.to()

suspend fun RemoteClient.projectCommands(projectId: String, provider: String): List<ProviderCommand> =
    desktop("projectCommands", listOf(p(projectId), p(provider))).to()

suspend fun RemoteClient.providerUsage(provider: String, force: Boolean): ProviderUsage =
    desktop("providerUsage", listOf(p(provider), JsonPrimitive(force))).to()

suspend fun RemoteClient.newThreadAgent(): String? =
    desktop("newThreadAgent").takeUnless { it is JsonNull }?.let { (it as? JsonPrimitive)?.content }

suspend fun RemoteClient.aiSettings(): NewThreadAI = desktop("aiSettings").to()

/** Each computer's AI settings as last read, so a composer lists its agents in order at once. */
object AgentPrefs {
    private val known = ConcurrentHashMap<String, NewThreadAI>()

    fun known(computer: String?): NewThreadAI? = computer?.let { known[it] }

    suspend fun load(client: RemoteClient, computer: String): NewThreadAI? =
        runCatching { client.aiSettings() }.getOrNull()?.also { known[computer] = it } ?: known[computer]
}

suspend fun RemoteClient.newThreadModels(): NewThreadModels = desktop("newThreadModels").to()

suspend fun RemoteClient.saveNewThreadAgent(provider: String) {
    desktop("saveNewThreadAgent", listOf(p(provider)))
}

suspend fun RemoteClient.saveNewThreadModel(provider: String, model: NewThreadModel) {
    desktop("saveNewThreadModel", listOf(p(provider), RemoteJson.encodeToJsonElement(model)))
}

@Serializable data class CreatedChat(val id: String, val title: String = "")

/** A thread in [projectId]; [workspace] "checkout" | "worktree", left out for plain folders. */
suspend fun RemoteClient.createProjectChat(projectId: String, workspace: String?): CreatedChat {
    val scope = buildJsonObject { put("kind", JsonPrimitive("project")) }
    val args = mutableListOf<JsonElement?>(p(projectId), scope)
    if (workspace != null) args += p(workspace)
    return desktop("createProjectChat", args).to()
}

/** The Scratchpad's own project, made when missing; its id. */
suspend fun RemoteClient.createScratch(): String {
    val made = desktop("createScratch")
    return (made as? JsonPrimitive)?.content ?: made.jsonObject["id"].let { (it as JsonPrimitive).content }
}

suspend fun RemoteClient.cancelChat(chatId: String) {
    desktop("cancelProjectChat", listOf(p(chatId)))
}

suspend fun RemoteClient.compactChat(chatId: String, rootId: String? = null, args: String = "") {
    val list = mutableListOf<JsonElement?>(p(chatId), p(rootId))
    if (args.isNotEmpty()) list += p(args)
    desktop("compactProjectChat", list)
}

/** A new thread's composer as the desktop would start it, and the models it remembers per agent; each lookup may fail on its own. */
suspend fun RemoteClient.desktopNewThread(): Pair<ResumeSettings, NewThreadModels> = coroutineScope {
    val last = async { runCatching { newThreadAgent() }.getOrNull() }
    val ai = async { runCatching { aiSettings() }.getOrNull() }
    val models = async { runCatching { newThreadModels() }.getOrDefault(emptyMap()) }
    newThreadSettingsFrom(last.await(), ai.await(), models.await()) to models.await()
}

suspend fun RemoteClient.reloadChatSession(chatId: String) {
    desktop("reloadProjectChatSession", listOf(p(chatId)))
}

/**
 * Model lists, held per connection (mobile's model-catalogs): the toolbar
 * names the model at once, and a reconnect asks again. Until this
 * connection's own arrive, the copy saved last time stands in.
 */
object ModelLists {
    private val lists = ConcurrentHashMap<String, List<AgentModel>>()
    /** The last lists saved per computer, by agent. */
    private val saved = ConcurrentHashMap<String, ModelCatalogs>()
    private val read = ConcurrentHashMap.newKeySet<String>()
    private var connection = -1

    private fun key(computer: String, provider: String) = "$computer:$provider"

    /** What this connection already listed, by agent, over the saved copy. */
    fun known(computer: String?, connection: Int): ModelCatalogs {
        if (computer == null) return emptyMap()
        startOver(connection)
        val prefix = "$computer:"
        return saved[computer].orEmpty() + lists.filterKeys { it.startsWith(prefix) }.mapKeys { it.key.removePrefix(prefix) }
    }

    /** Reads the saved copy once per computer; true when it brought something. */
    suspend fun readSaved(saves: ComposerSaves, computer: String): Boolean {
        if (!read.add(computer)) return false
        val lists = saves.models(computer)?.takeIf { it.isNotEmpty() } ?: return false
        saved.merge(computer, lists) { mine, disk -> disk + mine }
        return true
    }

    /**
     * Lists [wanted] not yet asked this connection. One the desktop couldn't
     * list, or listed empty while its CLI starts, is asked again next time.
     */
    suspend fun load(client: RemoteClient, computer: String, connection: Int, wanted: List<String>, saves: ComposerSaves? = null): ModelCatalogs {
        startOver(connection)
        coroutineScope {
            wanted.filter { !lists.containsKey(key(computer, it)) }.map { provider ->
                async {
                    val list = runCatching { client.agentModels(provider) }.getOrNull()
                    // A previous connection can finish after its replacement.
                    if (list.isNullOrEmpty() || connection != this@ModelLists.connection) return@async
                    lists[key(computer, provider)] = list
                    val next = saved.merge(computer, mapOf(provider to list)) { old, new -> old + new }!!
                    saves?.saveModels(computer, next)
                }
            }.forEach { it.await() }
        }
        return known(computer, connection)
    }

    @Synchronized private fun startOver(now: Int) {
        if (now == connection) return
        connection = now
        lists.clear()
    }
}

/** The last usage each computer reported per agent, so a thread opens with its meters drawn. */
internal val lastUsage = ConcurrentHashMap<String, ProviderUsage>()
