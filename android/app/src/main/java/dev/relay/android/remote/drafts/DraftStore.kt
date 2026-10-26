package dev.relay.android.remote.drafts

import dev.relay.android.remote.Bridge
import dev.relay.android.remote.model.DraftChange
import dev.relay.android.remote.model.DraftExtras
import dev.relay.android.remote.model.DraftWrite
import dev.relay.android.remote.model.RemoteOverview
import dev.relay.android.remote.model.SharedDraft
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import java.io.File

/** How the store reaches the computer while it's online. */
interface DraftLink {
    suspend fun save(write: DraftWrite): SharedDraft?
    suspend fun other(key: String, drop: Boolean): SharedDraft?
}

/** A composer's copy here, and how it stands with the computer's. */
@Serializable
data class DraftCopy(
    override val body: DraftBody,
    override val extras: DraftExtras? = null,
    override val synced: Long? = null,
    override val dirty: Long? = null,
    /** Sent through the computer, which drops it once it's done; hidden until then. */
    val leaving: Long? = null,
    /** What a send from here took, until the computer hears it went. */
    val sent: String? = null,
) : LocalDraft

@Serializable
private data class Saved(
    val copies: Map<String, DraftCopy> = emptyMap(),
    val theirs: List<SharedDraft> = emptyList(),
    /** Each project's new thread being written here. */
    val slots: Map<String, String> = emptyMap(),
    val device: String? = null,
)

/** A draft as a list shows it. */
data class ListedDraft(
    val key: String,
    val text: String,
    /** "here", "computer" or "phone": where it was started, from this phone's view. */
    val from: String,
    val extras: DraftExtras?,
    val at: Long,
)

/** Kept on the phone alone: a key the computer wouldn't take. */
const val scratchDraftKey = "~scratch"

/**
 * mobile/src/remote/drafts.ts: unsent composer text per computer and
 * composer, kept on the phone and shared with the computer from
 * [Bridge.DRAFTS] on. Typing goes on offline and goes once the computer is
 * back. Every call must come from [scope]'s one thread.
 */
class DraftStore(
    private val dir: File?,
    private val scope: CoroutineScope,
    private val now: () -> Long = System::currentTimeMillis,
    private val io: CoroutineDispatcher = Dispatchers.IO,
    /** The clock an overview's askedAt is on. */
    private val ticks: () -> Long = System::nanoTime,
) {
    private val json = Json { ignoreUnknownKeys = true; explicitNulls = false; encodeDefaults = false }
    private val copies = HashMap<String, LinkedHashMap<String, DraftCopy>>()
    private val theirs = HashMap<String, LinkedHashMap<String, SharedDraft>>()
    private val slots = HashMap<String, Map<String, String>>()
    private val devices = HashMap<String, String>()
    /** When this phone last heard how each draft stands on the computer, on [ticks]. */
    private val heardAt = HashMap<String, HashMap<String, Long>>()
    private val loading = HashMap<String, CompletableDeferred<Unit>>()
    private var link: Pair<String, DraftLink>? = null

    private val held = HashSet<String>()
    private val pushing = HashSet<String>()
    private val timers = HashMap<String, Job>()
    private val saveTimers = HashMap<String, Job>()
    private fun id(computer: String, key: String) = "$computer\n$key"

    private val _version = MutableStateFlow(0L)
    /** Bumped on every change; read [listed] and the rest after it. */
    val version: StateFlow<Long> = _version.asStateFlow()
    private val _keys = MutableSharedFlow<String>(extraBufferCapacity = 256)
    /** `computer\nkey` of a draft whose text changed under its composer. */
    val keyChanges: SharedFlow<String> = _keys.asSharedFlow()

    private fun notifyKey(computer: String, key: String) {
        _keys.tryEmit(id(computer, key))
    }

    private fun changed(computer: String, key: String? = null) {
        _version.value++
        if (key != null) notifyKey(computer, key)
        persist(computer)
    }

    private fun mine(computer: String) = copies.getOrPut(computer) { LinkedHashMap() }
    private fun known(computer: String) = theirs.getOrPut(computer) { LinkedHashMap() }
    private fun shareable(key: String) = draftKeyPattern.matches(key)
    private fun heardNow(computer: String, key: String) {
        heardAt.getOrPut(computer) { HashMap() }[key] = ticks()
    }

    private fun heardSince(computer: String, at: Long): Set<String> =
        heardAt[computer]?.filterValues { it >= at }?.keys.orEmpty()

    private fun leaving(copy: DraftCopy) = copy.leaving != null && now() - copy.leaving < LEAVING_MS
    private fun file(computer: String) = dir?.let { File(it, "${computer.hashCode().toUInt().toString(16)}-${computer.length}.json") }

    /** Reads the computer's drafts kept here, once. */
    suspend fun load(computer: String) {
        loading[computer]?.let { return it.await() }
        val done = CompletableDeferred<Unit>()
        loading[computer] = done
        val saved = file(computer)?.let { f ->
            withContext(io) { runCatching { if (f.exists()) json.decodeFromString<Saved>(f.readText()) else null }.getOrNull() }
        }
        if (saved != null) {
            val map = mine(computer)
            for ((key, copy) in saved.copies) if (key !in map) map[key] = copy
            for (draft in saved.theirs) known(computer)[draft.key] = draft
            slots[computer] = saved.slots + slots[computer].orEmpty()
            if (saved.device != null && computer !in devices) devices[computer] = saved.device
        }
        done.complete(Unit)
        changed(computer)
    }

    private fun persist(computer: String) {
        val f = file(computer) ?: return
        saveTimers[computer]?.cancel()
        saveTimers[computer] = scope.launch {
            delay(300)
            saveTimers.remove(computer)
            val text = json.encodeToString(
                Saved.serializer(),
                Saved(HashMap(mine(computer)), known(computer).values.toList(), slots[computer].orEmpty(), devices[computer]),
            )
            withContext(io) {
                runCatching {
                    f.parentFile?.mkdirs()
                    val tmp = File(f.parentFile, f.name + ".tmp")
                    tmp.writeText(text)
                    tmp.renameTo(f)
                }
            }
        }
    }

    /** Whether a draft's writer is this phone. */
    fun isThisPhone(computer: String, device: String) = devices[computer]?.let { device == phoneDevice(it) } == true

    /** Which phone this is to the computer, to tell its own drafts from another phone's. */
    fun device(computer: String, deviceId: String) {
        devices[computer] = deviceId
        scope.launch { load(computer) }
    }

    /**
     * Online with a fresh overview, asked for at [askedAt] on [ticks]: lines
     * the drafts here up with the computer's.
     */
    suspend fun online(computer: String, to: DraftLink, overview: RemoteOverview, askedAt: Long = ticks()) {
        load(computer)
        val drafts = overview.drafts
        if ((overview.bridge ?: 1) < Bridge.DRAFTS || drafts == null) {
            // A computer from before sharing: drafts stay here.
            if (link?.first == computer) link = null
            return
        }
        link = computer to to
        // Heard of since the overview was asked for, so it may list them as they were before:
        // a draft pushed on reconnect would read as deleted there.
        val newer = heardSince(computer, askedAt)
        val map = mine(computer)
        val there = known(computer)
        there.keys.retainAll(newer)
        for (draft in drafts) if (draft.key !in newer) there[draft.key] = draft
        val local = map.filter { (key, copy) -> shareable(key) && !leaving(copy) && (key !in newer || copy.dirty != null) }
        val plan = reconcileDrafts(local, drafts.filter { it.key !in newer })
        for (draft in plan.take) {
            val copy = map[draft.key]
            if (copy != null && leaving(copy)) continue
            map[draft.key] = DraftCopy(draft.body(), synced = draft.rev)
            notifyKey(computer, draft.key)
        }
        for (key in plan.drop) {
            map.remove(key)
            notifyKey(computer, key)
        }
        // Gone from the computer meanwhile: a send through it is done.
        map.entries.removeAll { (key, copy) -> copy.leaving != null && key !in there }
        changed(computer)
        for (key in plan.push) scope.launch { push(computer, key) }
    }

    fun offline(computer: String) {
        if (link?.first == computer) link = null
    }

    /** A draft changed on the computer, or on another phone. */
    fun heard(computer: String, change: DraftChange) {
        val (key, draft) = change.key to change.draft
        heardNow(computer, key)
        if (draft != null) known(computer)[key] = draft else known(computer).remove(key)
        val map = mine(computer)
        val copy = map[key]
        val busy = copy?.dirty != null || id(computer, key) in held || id(computer, key) in pushing
        if (busy || (copy != null && leaving(copy) && draft != null)) return changed(computer)
        if (draft == null) map.remove(key)
        else if (copy == null || copy.synced != draft.rev) map[key] = DraftCopy(draft.body(), synced = draft.rev)
        changed(computer, key)
    }

    /** An edit here: kept at once, sent a pause later. Ignored while a send holds the composer. */
    fun edit(computer: String, key: String, change: (DraftBody) -> DraftBody) {
        if (id(computer, key) in held) return
        val map = mine(computer)
        val copy = map[key]
        // One on its way out shows as empty; only something new typed replaces it.
        val shown = if (copy != null && !leaving(copy)) copy.body else DraftBody("")
        val body = change(shown).normal()
        if (copy != null && sameBody(shown, body)) return
        if (copy == null && body.text.isBlank()) return
        map[key] = (copy ?: DraftCopy(body)).copy(body = body, dirty = now(), leaving = null, sent = null)
        changed(computer)
        schedule(computer, key)
    }

    fun editText(computer: String, key: String, text: String) = edit(computer, key) { it.copy(text = text) }

    private fun schedule(computer: String, key: String) {
        if (!shareable(key)) return
        val at = id(computer, key)
        timers[at]?.cancel()
        timers[at] = scope.launch {
            delay(PAUSE_MS)
            timers.remove(at)
            push(computer, key)
        }
    }

    private suspend fun push(computer: String, key: String) {
        val at = id(computer, key)
        val to = link
        val copy = mine(computer)[key]
        // Offline it stays edited, and goes once the computer is back.
        if (to == null || to.first != computer || copy?.dirty == null || at in held) return
        if (at in pushing) return schedule(computer, key)
        pushing += at
        val editedAt = copy.dirty
        val b = copy.body.normal()
        val write = DraftWrite(key, copy.synced ?: 0, editedAt, b.text, b.skills, b.quotes, b.files, b.workspace, copy.sent)
        try {
            val after = to.second.save(write)
            settle(computer, key, after, editedAt)
        } catch (e: Exception) {
            if (e is kotlinx.coroutines.CancellationException) throw e
            // Still edited: the next edit or reconnect sends it.
        } finally {
            pushing -= at
        }
    }

    /** The computer took a write: `after` is how the draft stands now. */
    private fun settle(computer: String, key: String, after: SharedDraft?, editedAt: Long) {
        heardNow(computer, key)
        if (after != null) known(computer)[key] = after else known(computer).remove(key)
        val map = mine(computer)
        val copy = map[key] ?: return changed(computer)
        // Typed again meanwhile: the next push goes from this version.
        if (copy.dirty != editedAt) {
            map[key] = copy.copy(synced = after?.rev ?: copy.synced)
            schedule(computer, key)
            return changed(computer)
        }
        if (after == null) {
            map.remove(key)
            return changed(computer, key)
        }
        val lost = !sameBody(copy.body, after.body())
        map[key] = DraftCopy(after.body(), synced = after.rev)
        changed(computer, if (lost) key else null)
    }

    /** A send is taking the composer's text: edits wait until it went or came back. */
    fun hold(computer: String, key: String) {
        held += id(computer, key)
    }

    /** The send came back: the composer has its text again. */
    fun release(computer: String, key: String) {
        held -= id(computer, key)
    }

    /**
     * The send went. Through the computer, it drops the draft itself once
     * done; otherwise this tells it the text went, so what was typed there since stays.
     */
    fun went(computer: String, key: String, text: String, throughComputer: Boolean) {
        held -= id(computer, key)
        // The next new thread in its project starts a draft of its own.
        slots[computer]?.let { own -> if (key in own.values) slots[computer] = own.filterValues { it != key } }
        val map = mine(computer)
        val copy = map[key] ?: return
        if (throughComputer) {
            map[key] = copy.copy(leaving = now())
            return changed(computer)
        }
        if (!shareable(key) || (copy.synced == null && link?.first != computer)) map.remove(key)
        else {
            map[key] = DraftCopy(DraftBody(""), synced = copy.synced, dirty = now(), sent = text)
            scope.launch { push(computer, key) }
        }
        changed(computer, key)
    }

    /** Swaps in the version a clash kept, or with [drop] lets it go. */
    suspend fun resolveOther(computer: String, key: String, drop: Boolean) {
        val to = link
        if (to == null || to.first != computer) throw IllegalStateException("Wait for your computer to come back.")
        val at = id(computer, key)
        timers.remove(at)?.cancel()
        push(computer, key)
        val after = to.second.other(key, drop)
        heardNow(computer, key)
        if (after != null) {
            known(computer)[key] = after
            mine(computer)[key] = DraftCopy(after.body(), synced = after.rev)
        }
        changed(computer, key)
    }

    /** The key a project's new thread is written under here, a fresh one once the last went. */
    fun newThreadKey(computer: String, projectId: String): String {
        val own = slots[computer].orEmpty()
        own[projectId]?.let { return it }
        val key = "new:$projectId:${now().toString(36)}"
        slots[computer] = own + (projectId to key)
        persist(computer)
        return key
    }

    /** Opens this one for its project: one started on the computer, picked from the list. */
    fun pickNewThread(computer: String, projectId: String, key: String) {
        slots[computer] = slots[computer].orEmpty() + (projectId to key)
        persist(computer)
    }

    /** What's typed follows the new thread to another project. */
    fun move(computer: String, from: String, to: String) {
        val map = mine(computer)
        val copy = map[from] ?: return
        val typed = copy.body.text.trim()
        if (typed.isEmpty()) return
        val there = map[to]?.body?.text?.trim()
        edit(computer, to) {
            copy.body.copy(text = if (!there.isNullOrEmpty() && there != typed) "$there\n\n$typed" else copy.body.text)
        }
        edit(computer, from) { it.copy(text = "") }
    }

    /** What the composer shows; nothing for one on its way out through the computer. */
    fun text(computer: String, key: String): String {
        val copy = mine(computer)[key] ?: return ""
        return if (leaving(copy)) "" else copy.body.text
    }

    /** Where a new thread's draft will work, as picked here or on the computer. */
    fun workspace(computer: String, key: String) = mine(computer)[key]?.body?.workspace ?: known(computer)[key]?.workspace

    /** The computer's copy of a draft: where it started, what it holds there, a version a clash kept. */
    fun shared(computer: String, key: String): SharedDraft? = known(computer)[key]

    private var listedAt = -1L to (null as String?)
    private var listedCache: Map<String, ListedDraft> = emptyMap()

    /** Every draft of the computer's worth listing, by key. */
    fun listed(computer: String?): Map<String, ListedDraft> {
        if (listedAt == (_version.value to computer)) return listedCache
        val drafts = LinkedHashMap<String, ListedDraft>()
        if (computer != null) {
            val me = devices[computer]
            fun from(origin: String?) = when {
                origin == null || (me != null && origin == phoneDevice(me)) -> "here"
                origin == "desktop" -> "computer"
                else -> "phone"
            }
            val there = known(computer)
            for ((key, copy) in mine(computer)) {
                if (!shareable(key) || leaving(copy)) continue
                val draft = there[key]
                val extras = draft?.extras
                if (copy.body.text.isBlank() && !hasExtras(extras)) continue
                drafts[key] = ListedDraft(key, copy.body.text, from(draft?.origin), extras, copy.dirty ?: draft?.at ?: 0)
            }
        }
        listedAt = _version.value to computer
        listedCache = drafts
        return drafts
    }

    /** A computer forgotten takes its drafts here with it. */
    fun forget(computer: String) {
        copies.remove(computer)
        theirs.remove(computer)
        slots.remove(computer)
        devices.remove(computer)
        heardAt.remove(computer)
        loading.remove(computer)
        if (link?.first == computer) link = null
        saveTimers.remove(computer)?.cancel()
        file(computer)?.let { f -> scope.launch { withContext(io) { f.delete() } } }
        _version.value++
    }

    companion object {
        const val PAUSE_MS = 400L
        /** A send through the computer has this long before its copy shows again. */
        const val LEAVING_MS = 120_000L
    }
}

/** The draft a thread's row shows: its main conversation's, else a side one's. */
fun threadDraft(drafts: Map<String, ListedDraft>, chatId: String): ListedDraft? =
    drafts[chatId] ?: drafts.entries.firstOrNull { it.key.startsWith("$chatId:") }?.value
