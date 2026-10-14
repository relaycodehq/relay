package dev.relay.android.remote.outbox

import dev.relay.android.remote.Bridge
import dev.relay.android.remote.client.NotConnected
import dev.relay.android.remote.client.RemoteClient
import dev.relay.android.remote.client.Unanswered
import dev.relay.android.remote.client.chat
import dev.relay.android.remote.client.sendDraft
import dev.relay.android.remote.client.sendProjectChat
import dev.relay.android.remote.model.ProjectChatSend
import dev.relay.android.remote.model.RemoteChat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.async
import kotlinx.coroutines.launch
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.serialization.json.Json
import java.io.File

/** What the outbox sends through: the live connection, or one that refuses. */
interface OutboxLink {
    suspend fun send(chatId: String, send: ProjectChatSend)
    /** A send of a draft the desktop holds part of, through its composer. */
    suspend fun sendDraft(key: String, chatId: String, send: ProjectChatSend)
    suspend fun chat(chatId: String, sendId: String): RemoteChat
}

fun outboxLink(client: RemoteClient?): OutboxLink = object : OutboxLink {
    private fun live() = client ?: throw NotConnected("Not connected to your computer.")
    override suspend fun send(chatId: String, send: ProjectChatSend) {
        live().sendProjectChat(chatId, send)
    }
    override suspend fun sendDraft(key: String, chatId: String, send: ProjectChatSend) {
        live().sendDraft(key, chatId, send)
    }
    override suspend fun chat(chatId: String, sendId: String) = live().chat(chatId, null, Bridge.REMOTE_HISTORY, sendId)
}

/**
 * mobile/src/remote/outbox.ts: messages on their way to the desktop. The
 * thread shows one at once and the composer is free again; a failed one stays
 * to try again or take back. Until the desktop has it, it's also kept on disk,
 * so a send cut short by Android closing the app goes out on the next launch.
 * Every call must come from [scope]'s one thread.
 */
class Outbox(private val dir: File?, private val scope: CoroutineScope, private val now: () -> Long = System::currentTimeMillis) {
    private val json = Json { ignoreUnknownKeys = true; explicitNulls = false; encodeDefaults = false; coerceInputValues = true }
    private val _items = MutableStateFlow(kept())
    val items: StateFlow<List<Outgoing>> = _items.asStateFlow()

    /** Sends on their way right now, by id. */
    private val inFlight = HashMap<String, Deferred<Unit>>()
    /** Being asked about to take back for an edit; not sent again meanwhile. */
    private val takingBack = HashSet<String>()

    private fun shelved(id: String) = dir?.let { File(it, "$id.json") }

    private fun keep(o: Outgoing) {
        val file = shelved(o.send.id) ?: return
        // A full disk costs the copy; the send itself still goes.
        runCatching {
            file.parentFile?.mkdirs()
            file.writeText(json.encodeToString(Outgoing.serializer(), o.copy(sent = null, error = null, unsure = null)))
        }
    }

    private fun unkeep(id: String) {
        runCatching { shelved(id)?.delete() }
    }

    /** The ones the last run never got to the desktop, failed until they go again. */
    private fun kept(): List<Outgoing> {
        val files = dir?.listFiles { f -> f.name.endsWith(".json") } ?: return emptyList()
        return files.mapNotNull { f ->
            runCatching { json.decodeFromString(Outgoing.serializer(), f.readText()) }.getOrNull()
                ?.copy(error = "Relay closed before it went out", unsure = true)
        }.sortedBy { it.created }
    }

    private fun update(id: String, change: (Outgoing) -> Outgoing) {
        _items.value = _items.value.map { if (it.send.id == id) change(it) else it }
    }

    private fun run(link: OutboxLink, item: Outgoing) {
        val id = item.send.id
        val sending = scope.async {
            try {
                if (item.draft != null) link.sendDraft(item.draft, item.chatId, item.send)
                else link.send(item.chatId, item.send)
                unkeep(id)
                update(id) { it.copy(sent = stamp(), error = null, unsure = null) }
            } catch (e: Exception) {
                if (e is kotlinx.coroutines.CancellationException) throw e
                // A refused retry doesn't prove that an earlier unanswered copy failed.
                update(id) { it.copy(error = e.message ?: e.toString(), unsure = item.unsure == true || e is Unanswered) }
            }
        }
        inFlight[id] = sending
        sending.invokeOnCompletion { scope.launch { if (inFlight[id] === sending) inFlight.remove(id) } }
    }

    /** Sends in the background; the desktop drops a second copy of the same id, so trying again is safe. */
    fun deliver(link: OutboxLink, computer: String, chatId: String, send: ProjectChatSend, draft: String? = null) {
        val item = Outgoing(computer, chatId, send, now(), draft = draft)
        keep(item)
        _items.value = _items.value + item
        run(link, item)
    }

    fun retry(link: OutboxLink, id: String) {
        val item = _items.value.find { it.send.id == id } ?: return
        if (id in takingBack) return
        update(id) { it.copy(error = null) }
        run(link, item.copy(error = null))
    }

    /** Back online: the ones the lost link stopped go out again by themselves. */
    fun resendFailed(link: OutboxLink, computer: String) {
        for (o in _items.value) if (o.error != null && o.computer == computer) retry(link, o.send.id)
    }

    /** Still waiting here, unsent or failed. */
    fun isOut(id: String) = _items.value.any { it.send.id == id }

    fun drop(id: String) {
        unkeep(id)
        _items.value = _items.value.filter { it.send.id != id }
    }

    /** Forgets the ones thread [chatId] now holds itself, or no longer does, reading as [held] from a fetch made at [fetched]. */
    fun arrived(computer: String, chatId: String, held: Set<String>, fetched: Long) {
        val done = settled(_items.value, computer, chatId, held, fetched).toSet()
        if (done.isEmpty()) return
        done.forEach { unkeep(it.send.id) }
        _items.value = _items.value.filter { it !in done }
    }

    /**
     * Whether the desktop has one it never answered for: taken back to edit
     * and sent again, it would go twice.
     */
    suspend fun reached(link: OutboxLink, o: Outgoing): Boolean {
        val id = o.send.id
        // A copy still on its way, or resent as the link comes back, would land after a "no".
        takingBack += id
        try {
            inFlight[id]?.await()
            val thread = link.chat(o.chatId, id)
            val has = thread.hasSend ?: throw IllegalStateException("Update Relay on the computer before taking back an unanswered send.")
            // A receipt covers the full history, including an accepted send outside this page.
            if (has && thread.sendPending != true) drop(id)
            return has
        } finally {
            takingBack -= id
        }
    }

    fun of(computer: String, chatId: String) = _items.value.filter { it.computer == computer && it.chatId == chatId }

    /** A pasted image of one still on its way, which the desktop can't hand back yet. */
    // TODO(merge): features.images' PendingImages.lookup should point here; set in Sends.attach.
    fun outgoingImage(id: String, index: Int) = _items.value.find { it.send.id == id }?.send?.images?.getOrNull(index)?.dataUrl
}
