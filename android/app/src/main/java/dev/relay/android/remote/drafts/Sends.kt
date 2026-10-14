package dev.relay.android.remote.drafts

import dev.relay.android.remote.Remote
import dev.relay.android.remote.client.LinkState
import dev.relay.android.remote.client.RemoteClient
import dev.relay.android.remote.client.draftOther
import dev.relay.android.remote.client.saveDraft
import dev.relay.android.remote.model.DraftWrite
import dev.relay.android.remote.model.RemoteEvent
import dev.relay.android.remote.outbox.Outbox
import dev.relay.android.remote.outbox.outboxLink
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.filterIsInstance
import kotlinx.coroutines.launch
import java.io.File
import java.util.Collections
import java.util.WeakHashMap

private fun draftLink(client: RemoteClient) = object : DraftLink {
    override suspend fun save(write: DraftWrite) = client.saveDraft(write)
    override suspend fun other(key: String, drop: Boolean) = client.draftOther(key, drop)
}

/**
 * The phone's drafts and outbox, one of each for the app, and their wiring to
 * the connection (mobile's RemoteProvider): offline unlinks the drafts, every
 * fresh overview lines them up, the computer's draft events come in, and
 * coming back online resends what the lost link stopped.
 */
object Sends {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var stores: Pair<DraftStore, Outbox>? = null
    private val attached = Collections.newSetFromMap(WeakHashMap<Remote, Boolean>())
    private val _connection = MutableStateFlow(0)
    /** Bumped on every (re)connect: per-connection caches (model lists) start over. */
    val connection: StateFlow<Int> = _connection.asStateFlow()

    fun drafts(filesDir: File) = stores(filesDir).first
    fun outbox(filesDir: File) = stores(filesDir).second

    private fun stores(filesDir: File) = stores ?: Pair(
        DraftStore(File(filesDir, "relay-drafts"), scope),
        Outbox(File(filesDir, "relay-outbox"), scope),
    ).also { stores = it }

    /** Idempotent per [remote]; call from the main thread. */
    fun attach(remote: Remote, filesDir: File) {
        if (!attached.add(remote)) return
        val (drafts, outbox) = stores(filesDir)
        // TODO(merge): show unsent pasted images in the thread from the outbox:
        //   dev.relay.android.features.images.PendingImages.lookup = { messageId, index -> outbox.outgoingImage(messageId, index) }
        // (features.images landed on kotlin-phone after this branch split off.)
        // The overview's drafts list held when the link came up: the cached copy, not a fresh one.
        var stale: Any? = null
        var handled: Any? = null
        scope.launch {
            var was: LinkState? = null
            remote.status.collect { status ->
                val computer = remote.active.value
                if (status.state == LinkState.Online && was != LinkState.Online) {
                    stale = remote.overview.value?.drafts
                    handled = null
                    _connection.value++
                    if (computer != null) outbox.resendFailed(outboxLink(remote.client.value), computer)
                } else if (status.state != LinkState.Online && computer != null) {
                    drafts.offline(computer)
                }
                was = status.state
            }
        }
        scope.launch {
            remote.overview.collect { overview ->
                val computer = remote.active.value ?: return@collect
                val client = remote.client.value ?: return@collect
                if (overview == null || remote.status.value.state != LinkState.Online) return@collect
                val list = overview.drafts
                if (list === stale || (list != null && list === handled)) return@collect
                handled = list
                drafts.online(computer, draftLink(client), overview)
            }
        }
        scope.launch {
            remote.events.filterIsInstance<RemoteEvent.Draft>().collect { event ->
                remote.active.value?.let { drafts.heard(it, event.change) }
            }
        }
        scope.launch {
            remote.client.collect { client ->
                val credentials = client?.credentials ?: return@collect
                drafts.device(credentials.key, credentials.deviceId)
            }
        }
    }
}
