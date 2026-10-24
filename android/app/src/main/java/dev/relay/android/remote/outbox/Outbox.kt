package dev.relay.android.remote.outbox

import dev.relay.android.remote.Bridge
import dev.relay.android.remote.client.NotConnected
import dev.relay.android.remote.client.Rejected
import dev.relay.android.remote.client.RemoteClient
import dev.relay.android.remote.client.Unanswered
import dev.relay.android.remote.client.chat
import dev.relay.android.remote.client.sendDraft
import dev.relay.android.remote.client.sendProjectChat
import dev.relay.android.remote.client.uploadFile
import dev.relay.android.remote.files.AttachedFile
import dev.relay.android.remote.files.FILES_NEED_UPDATE
import dev.relay.android.remote.files.FileSink
import dev.relay.android.remote.files.deleteCopies
import dev.relay.android.remote.files.uploadAll
import dev.relay.android.remote.files.uploadRetryDelays
import dev.relay.android.remote.model.UploadedFile
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlin.coroutines.CoroutineContext
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
    /** A chunk of a file going with a send; see remote/files. */
    suspend fun upload(id: String, name: String, size: Long, offset: Long, data: String): UploadedFile =
        throw NotConnected("Not connected to your computer.")
    /** Whether the computer takes files; null while that isn't known. */
    val takesFiles: Boolean? get() = null
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
    override suspend fun upload(id: String, name: String, size: Long, offset: Long, data: String) =
        live().uploadFile(id, name, size, offset, data)
    override val takesFiles get() = client?.bridge?.let { it >= Bridge.FILES }
}

/**
 * mobile/src/remote/outbox.ts: messages on their way to the desktop. The
 * thread shows one at once and the composer is free again; a failed one stays
 * to try again or take back. Until the desktop has it, it's also kept on disk,
 * so a send cut short by Android closing the app goes out on the next launch.
 * Every call must come from [scope]'s one thread.
 */
class Outbox(
    private val dir: File?,
    private val scope: CoroutineScope,
    private val now: () -> Long = System::currentTimeMillis,
    /** Where files are read to go up. */
    private val io: CoroutineContext = Dispatchers.IO,
) {
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
            // A refusal stays refused across launches; only trying again lifts it.
            val copy = if (o.refused == true) o.copy(sent = null) else o.copy(sent = null, error = null, unsure = null, refused = null)
            file.writeText(json.encodeToString(Outgoing.serializer(), copy))
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
                ?.let { if (it.refused == true) it else it.copy(error = "Relay closed before it went out", unsure = true) }
        }.sortedBy { it.created }
    }

    /** Every file a kept send still needs, so a sweep of the copies leaves them. */
    fun files(): List<AttachedFile> = _items.value.flatMap { it.files.orEmpty() }

    private fun update(id: String, change: (Outgoing) -> Outgoing) {
        _items.value = _items.value.map { if (it.send.id == id) change(it) else it }
    }

    private fun current(id: String) = _items.value.find { it.send.id == id }

    /**
     * Its files, all of them on its computer: each carries on from where that
     * computer says it got to. A failure that may pass is tried again a few
     * times; past those, or refused, the send fails and waits for Try again.
     */
    private suspend fun uploaded(link: OutboxLink, item: Outgoing): Outgoing {
        val id = item.send.id
        if (item.files.isNullOrEmpty() || item.files.all { it.path != null && it.computer == item.computer }) return item
        if (link.takesFiles == false) throw Rejected(FILES_NEED_UPDATE)
        val sink = FileSink(link::upload)
        var attempt = 0
        while (true) {
            val files = current(id)?.files ?: item.files
            try {
                val done = uploadAll(sink, files, item.computer, io) { now ->
                    update(id) { it.copy(files = now) }
                    current(id)?.let { keep(it) }
                }
                update(id) { it.copy(files = done) }
                return (current(id) ?: item).copy(files = done)
            } catch (e: Exception) {
                if (e is kotlinx.coroutines.CancellationException || e is Rejected || e is NotConnected || attempt >= uploadRetryDelays.size) throw e
                delay(uploadRetryDelays[attempt++])
            }
        }
    }

    private fun run(link: OutboxLink, item: Outgoing) {
        val id = item.send.id
        val sending = scope.async {
            try {
                val ready = uploaded(link, item)
                if (ready.draft != null) link.sendDraft(ready.draft, ready.chatId, ready.withPaths())
                else link.send(ready.chatId, ready.withPaths())
                unkeep(id)
                ready.files?.let(::deleteCopies)
                update(id) { it.copy(sent = stamp(), error = null, unsure = null, refused = null) }
            } catch (e: Exception) {
                if (e is kotlinx.coroutines.CancellationException) throw e
                // A refused retry doesn't prove that an earlier unanswered copy failed.
                update(id) {
                    it.copy(
                        error = e.message ?: e.toString(),
                        unsure = item.unsure == true || e is Unanswered,
                        refused = if (e is Rejected) true else null,
                    )
                }
                if (e is Rejected) _items.value.find { it.send.id == id }?.let { keep(it) }
            }
        }
        inFlight[id] = sending
        sending.invokeOnCompletion { scope.launch { if (inFlight[id] === sending) inFlight.remove(id) } }
    }

    /** Sends in the background; the desktop drops a second copy of the same id, so trying again is safe. */
    fun deliver(link: OutboxLink, computer: String, chatId: String, send: ProjectChatSend, draft: String? = null, files: List<AttachedFile>? = null) {
        val item = Outgoing(computer, chatId, send, now(), draft = draft, files = files?.takeIf { it.isNotEmpty() })
        keep(item)
        _items.value = _items.value + item
        run(link, item)
    }

    fun retry(link: OutboxLink, id: String) {
        val item = _items.value.find { it.send.id == id } ?: return
        if (id in takingBack) return
        val again = item.copy(error = null, refused = null)
        update(id) { it.copy(error = null, refused = null) }
        keep(again)
        run(link, again)
    }

    /** Back online: the ones the lost link stopped go out again by themselves; a refused one would only be refused again. */
    fun resendFailed(link: OutboxLink, computer: String) {
        for (o in _items.value) if (o.error != null && o.refused != true && o.computer == computer) retry(link, o.send.id)
    }

    /** How far its files got, while they're going up; see [uploadPercent]. */
    fun uploadPercent(id: String) = current(id)?.let(::uploadPercent)

    /** Still waiting here, unsent or failed. */
    fun isOut(id: String) = _items.value.any { it.send.id == id }

    /** Taken back: its files go back to the composer, so their copies stay. */
    fun drop(id: String) {
        unkeep(id)
        _items.value = _items.value.filter { it.send.id != id }
    }

    /** Forgets the ones thread [chatId] now holds itself, or no longer does, reading as [held] from a fetch made at [fetched]. */
    fun arrived(computer: String, chatId: String, held: Set<String>, fetched: Long) {
        val done = settled(_items.value, computer, chatId, held, fetched).toSet()
        if (done.isEmpty()) return
        done.forEach {
            unkeep(it.send.id)
            it.files?.let(::deleteCopies)
        }
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
            if (has && thread.sendPending != true) {
                current(id)?.files?.let(::deleteCopies)
                drop(id)
            }
            return has
        } finally {
            takingBack -= id
        }
    }

    fun of(computer: String, chatId: String) = _items.value.filter { it.computer == computer && it.chatId == chatId }

    /** A pasted image of one still on its way, which the desktop can't hand back yet. */
    fun outgoingImage(id: String, index: Int) = _items.value.find { it.send.id == id }?.send?.images?.getOrNull(index)?.dataUrl
}
