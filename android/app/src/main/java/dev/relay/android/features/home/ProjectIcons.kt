package dev.relay.android.features.home

import dev.relay.android.remote.Remote
import dev.relay.android.remote.client.LinkState
import dev.relay.android.remote.client.RemoteClient
import dev.relay.android.remote.client.projectIcons
import dev.relay.android.remote.model.RemoteJson
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.io.File
import java.util.Base64

/** Icons rarely change; a project the phone hasn't seen asks sooner. */
private const val FRESH_MS = 10 * 60_000L
private const val RETRY_MS = 30_000L

/**
 * Projects' own icons, kept as files (mobile/src/remote/project-icons.ts). The desktop sends an
 * icon only when the phone's copy is missing or stale by hash; each file is named by its hash, so
 * a new icon is a new path and image caches never show the old one.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class ProjectIcons(private val folder: File, private val indexFile: File, private val now: () -> Long = System::currentTimeMillis) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO.limitedParallelism(1))
    private val lock = Mutex()
    private val _index = MutableStateFlow<IconIndex>(emptyMap())
    val index: StateFlow<IconIndex> = _index.asStateFlow()
    /** When each computer's icons were last checked. */
    private val checked = mutableMapOf<String, Long>()

    init {
        scope.launch { lock.withLock { _index.value = load() } }
    }

    /** Keeps the active computer's icons current while it's online, and drops forgotten computers' icons. */
    fun start(remote: Remote) {
        scope.launch {
            data class Want(val computer: String?, val client: RemoteClient?, val online: Boolean, val ids: List<String>)
            combine(remote.active, remote.client, remote.status, remote.overview) { active, client, status, overview ->
                Want(active, client, status.state == LinkState.Online, overview?.projects.orEmpty().map { it.id })
            }.distinctUntilChanged().collectLatest { want ->
                if (want.computer == null || want.client == null || !want.online || want.ids.isEmpty()) return@collectLatest
                // sync() decides when it's due; this only gives it the chance.
                while (true) {
                    sync(want.computer, want.client, want.ids)
                    delay(RETRY_MS)
                }
            }
        }
        scope.launch {
            var known: Set<String>? = null
            remote.ready.collectLatest { ready ->
                if (!ready) return@collectLatest
                remote.computers.collect { list ->
                    val ids = list.map { it.id }.toSet()
                    known?.minus(ids)?.forEach { forget(it) }
                    known = ids
                }
            }
        }
    }

    private suspend fun sync(computer: String, client: RemoteClient, ids: List<String>) {
        val known = lock.withLock {
            val mine = _index.value[computer].orEmpty()
            val missing = ids.any { it !in mine }
            if (now() - (checked[computer] ?: 0L) < if (missing) RETRY_MS else FRESH_MS) return
            knownHashes(_index.value, computer, ids)
        }
        val updates = try {
            client.projectIcons(known)
        } catch (_: Exception) {
            // An older desktop has no icons to give; the files stay.
            lock.withLock { checked[computer] = now() }
            return
        }
        lock.withLock {
            val next = applyIconUpdates(_index.value, computer, ids, updates) { id, hash, dataUrl -> save(computer, id, hash, dataUrl) }
            next.unused.forEach { runCatching { File(it).delete() } }
            _index.value = next.index
            checked[computer] = now()
            persist()
        }
    }

    private fun save(computer: String, id: String, hash: String, dataUrl: String): String? {
        val (extension, data) = iconData(dataUrl) ?: return null
        return try {
            val dir = File(folder, computer).apply { mkdirs() }
            val file = File(dir, "$id-$hash.$extension")
            file.writeBytes(Base64.getMimeDecoder().decode(data))
            file.absolutePath
        } catch (_: Exception) {
            null
        }
    }

    /** A forgotten computer's icons go with it. */
    private suspend fun forget(computer: String) = lock.withLock {
        _index.value -= computer
        checked.remove(computer)
        runCatching { File(folder, computer).deleteRecursively() }
        persist()
    }

    private fun persist() {
        runCatching {
            indexFile.parentFile?.mkdirs()
            indexFile.writeText(RemoteJson.encodeToString(_index.value))
        }
    }

    /** The saved index, minus anything whose file the system cleared away. */
    private fun load(): IconIndex = runCatching {
        if (!indexFile.exists()) return emptyMap()
        val stored: IconIndex = RemoteJson.decodeFromString(indexFile.readText())
        stored.mapValues { (_, mine) -> mine.filterValues { it.path == null || File(it.path).exists() } }
    }.getOrDefault(emptyMap())
}
