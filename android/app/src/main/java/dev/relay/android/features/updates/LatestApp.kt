package dev.relay.android.features.updates

import android.util.Log
import dev.relay.android.remote.model.newerVersion
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

data class LatestAppState(
    val newest: NewestApp? = null,
    val checkedAt: Long? = null,
    val checking: Boolean = false,
    val error: String? = null,
)

/** Where the last look is kept between launches. */
interface LatestAppStorage {
    fun read(): String?
    fun write(text: String)
}

@Serializable
private data class Saved(
    val newest: NewestApp? = null,
    val checkedAt: Long? = null,
    val triedAt: Long? = null,
    val error: String? = null,
)

/**
 * mobile/src/remote/latest-app.ts: the phone looks up the newest Relay app in
 * the public release feed itself, so it updates with or without a desktop.
 * Checks run at start and on each return to the front, at most every six
 * hours (ten minutes after a failure); Settings' Check goes any time.
 */
class LatestApp(
    private val fetch: suspend () -> NewestApp,
    private val storage: LatestAppStorage,
    /** The version the installed APK carries; with no over-the-air code, also what runs. */
    val installed: String,
    private val packageName: String,
    /** Development builds can't take the release APK (different signing key). */
    private val releaseBuild: Boolean,
    private val metered: () -> Boolean?,
    private val prefetch: (NewestApp) -> Unit,
    private val now: () -> Long = System::currentTimeMillis,
    private val timeoutMs: Long = 20_000,
    private val warn: (String, Throwable) -> Unit = { m, e -> Log.w(TAG, m, e) },
) {
    private val _state = MutableStateFlow(LatestAppState())
    val state: StateFlow<LatestAppState> = _state.asStateFlow()

    private var triedAt = 0L
    private var loaded = false
    private val busy = Mutex()

    private fun load() {
        if (loaded) return
        loaded = true
        val saved = try {
            storage.read()?.let { json.decodeFromString<Saved>(it) }
        } catch (_: Exception) {
            null
        } ?: return
        // A damaged cache entry is dropped whole, as the TS schema parse does.
        if (saved.newest?.wellFormed() == false) return
        if ((saved.checkedAt ?: 0) < 0 || (saved.triedAt ?: 0) < 0) return
        triedAt = saved.triedAt ?: 0
        _state.value = _state.value.copy(newest = saved.newest, checkedAt = saved.checkedAt, error = saved.error)
    }

    private fun persist() {
        val s = _state.value
        try {
            storage.write(json.encodeToString(Saved.serializer(), Saved(s.newest, s.checkedAt, triedAt, s.error)))
        } catch (e: Exception) {
            warn("Couldn't save the app update check", e)
        }
    }

    /** The feed's app when this one should move to it, installable here or not. */
    fun offer(state: LatestAppState = _state.value): NewestApp? =
        state.newest?.takeIf { offersNewer(it, installed, installed) }

    /** The offer when this app can install it itself; otherwise only the release page helps. */
    fun installableOffer(state: LatestAppState = _state.value): NewestApp? =
        offer(state)?.takeIf { it.installableBy(packageName) }

    private fun prefetchLatest() {
        val offer = installableOffer() ?: return
        if (releaseBuild && metered() == false) prefetch(offer)
    }

    /** Looks at the release feed when the last look is old enough, or now with `force`. */
    suspend fun check(force: Boolean = false) {
        load()
        if (!busy.tryLock()) return
        try {
            val at = now()
            val s = _state.value
            if (!force && (if (s.error != null) at - triedAt < RETRY_MS else at - (s.checkedAt ?: 0) < EVERY_MS)) {
                prefetchLatest()
                return
            }
            triedAt = at
            _state.value = s.copy(checking = true, error = null)
            try {
                val newest = withTimeout(timeoutMs) { fetch() }
                val known = _state.value.newest
                // Older feeds infer the APK's version from the release; only an Android entry pins it.
                if (known != null && (
                        newerVersion(known.release, newest.release) ||
                            (known.sha512 != null && newerVersion(known.version, newest.version))
                        )
                ) throw FeedException("The release feed went back to an older release or app.")
                _state.value = LatestAppState(newest = newest, checkedAt = now(), checking = false)
                persist()
            } catch (e: TimeoutCancellationException) {
                fail("GitHub didn't answer.")
                return
            } catch (e: kotlinx.coroutines.CancellationException) {
                _state.value = _state.value.copy(checking = false)
                throw e
            } catch (e: Exception) {
                fail(e.message ?: e.toString())
                return
            }
            prefetchLatest()
        } finally {
            busy.unlock()
        }
    }

    private fun fail(message: String) {
        _state.value = _state.value.copy(checking = false, error = message)
        persist()
    }

    companion object {
        private const val TAG = "LatestApp"
        const val EVERY_MS = 6 * 60 * 60_000L
        const val RETRY_MS = 10 * 60_000L
        private val json = Json { ignoreUnknownKeys = true; explicitNulls = false }
    }
}
