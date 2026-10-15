package dev.relay.android.features.thread

// What the thread screen asks the computer to do, each saying when it failed.

import dev.relay.android.lib.navigation.Navigator
import dev.relay.android.lib.navigation.Route
import dev.relay.android.remote.Remote
import dev.relay.android.remote.model.ChatMessage
import dev.relay.android.remote.model.RemoteDiffSource
import dev.relay.android.remote.model.RemoteJson
import dev.relay.android.remote.model.ResumeSettings
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.encodeToJsonElement
import kotlinx.serialization.json.jsonPrimitive

class ThreadActions(
    private val remote: Remote,
    private val id: String,
    private val model: ThreadModel,
    private val scope: CoroutineScope,
    private val failures: FailureState,
    private val nav: Navigator,
) {
    /** Runs [job], then fetches the thread again; a failure says [failed]. */
    fun act(failed: String, unsure: String? = null, job: suspend () -> Unit) {
        scope.launch {
            attempt({ failures.alert(it, failed, unsure) }) {
                job()
                model.load()
            }
        }
    }

    fun triage(kind: String, failed: String, until: Long? = null) = act(failed) {
        remote.desktop("triageProjectChat", id, buildMap { put("kind", kind); until?.let { put("until", it) } })
    }

    fun rerunSetup(m: ChatMessage) = act("Couldn't run setup again") { remote.desktop("rerunWorktreeSetup", id, m.id) }

    fun fork(m: ChatMessage) {
        scope.launch {
            attempt({ failures.alert(it, "Couldn't fork it") }) {
                val made = remote.desktop("forkProjectChat", id, m.id) as? JsonObject
                made?.get("id")?.jsonPrimitive?.contentOrNull?.let { nav.push(Route.Thread(it)) }
            }
        }
    }

    /** Rolls a turn's files back or forward; says which files changed since, when it refused for them. */
    suspend fun rewind(m: ChatMessage, paths: List<String>?, mode: String, force: Boolean): List<String> {
        val result = remote.desktop("rewindProjectTurn", id, m.id, paths, mode, force)
        model.load()
        val conflicts = (result as? JsonObject)?.get("conflicts") as? JsonArray ?: return emptyList()
        return conflicts.mapNotNull { it.jsonPrimitive.contentOrNull }
    }

    /** Steers, removes or moves a queued message; false when it couldn't. */
    suspend fun queue(action: String, messageId: String, index: Int? = null): Boolean = try {
        remote.desktop("projectChatQueueAction", id, action, messageId, index)
        model.load()
        true
    } catch (e: kotlinx.coroutines.CancellationException) {
        throw e
    } catch (e: Exception) {
        failures.alert(e, "Couldn't change the queue")
        false
    }

    /** On the composer's settings, after [confirm] asks before another agent takes over. */
    fun resume(settings: ResumeSettings?, confirm: suspend (String) -> Boolean) = act("Couldn't resume") {
        if (settings != null && !confirm(settings.provider)) return@act
        remote.desktop("resumeProjectChat", id, settings?.let { RemoteJson.encodeToJsonElement(it) })
    }

    fun compact() = act("Couldn't compact it") { remote.desktop("compactProjectChat", id) }

    fun regenerateTitle() = act("Couldn't name it") {
        remote.desktop("regenerateProjectChatTitle", id)
        remote.refresh()
    }

    suspend fun rename(name: String) {
        remote.desktop("renameProjectChat", id, name)
        remote.refresh()
        model.load()
    }

    fun archive() {
        scope.launch {
            attempt({ failures.alert(it, "Couldn't archive it") }) {
                remote.desktop("triageProjectChat", id, mapOf("kind" to "archive"))
                nav.pop()
            }
        }
    }

    /** Marks it unread and leaves the whole thread; [leaving] keeps a trailing seen write from clearing the mark. */
    fun markUnread(leaving: (Boolean) -> Unit) {
        leaving(true)
        scope.launch {
            attempt({ leaving(false); failures.alert(it, "Couldn't mark it") }) {
                remote.desktop("triageProjectChat", id, mapOf("kind" to "unread"))
                runCatching { remote.refresh() }
                nav.home()
            }
        }
    }

    suspend fun respond(requestId: String, response: AgentResponse) {
        remote.desktop("respondProjectChat", id, requestId, response)
        model.load()
    }

    suspend fun stopPending(itemId: String) {
        remote.desktop("stopProjectChatPending", id, itemId)
        model.load()
    }

    suspend fun unsettle() {
        remote.desktop("triageProjectChat", id, mapOf("kind" to "unsettle"))
        // The strip reads the thread list's copy.
        runCatching { remote.refresh() }
    }

    suspend fun resolveStopped(action: String) {
        remote.desktop("resolveStoppedWork", id, action)
        model.load()
    }

    suspend fun setLimitResume(on: Boolean) {
        try {
            remote.desktop("setLimitResume", id, on)
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (e: Exception) {
            failures.alert(e, "Couldn't change it")
        }
    }

    fun openFile(path: String, messageId: String) =
        nav.push(Route.Diff(RemoteJson.encodeToString(RemoteDiffSource.serializer(), RemoteDiffSource.turn(id, messageId, path))))

    fun openTurn(m: ChatMessage) = nav.push(Route.Turn(id, m.id))
    fun openReplies(m: ChatMessage) = nav.push(Route.Reply(id, m.id))
}
