package dev.relay.android.features.updates

import android.util.Log
import dev.relay.android.remote.model.newerVersion
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class ApkOffer(val version: String, val url: String, val sha512: String? = null)

fun NewestApp.apkOffer() = ApkOffer(version, url, sha512)

sealed interface ApkInstall {
    data object Idle : ApkInstall
    sealed interface ForVersion : ApkInstall { val version: String }

    /** quiet: fetched ahead without being asked, so a failure stays quiet too. */
    data class Downloading(override val version: String, val done: Float, val quiet: Boolean) : ForVersion
    data class Downloaded(override val version: String) : ForVersion

    /** Waiting for the user to let Relay install apps. */
    data class Allow(override val version: String) : ForVersion

    /** Android's prompt is up; the app closes once the update is in. */
    data class Installing(override val version: String) : ForVersion
    data class Failed(override val version: String, val message: String) : ForVersion
}

enum class InstallOutcome { Installed, Cancelled }

/** What the installer needs from Android; AndroidApk is the real one. */
interface ApkNative {
    fun canInstall(): Boolean

    /** Opens Android's "Install unknown apps" switch for Relay. */
    fun allowInstalls()

    /** Answers the downloaded APK's path; a second call for the same version reuses it. */
    suspend fun download(url: String, version: String, sha512: String, onProgress: (Float) -> Unit): String

    /**
     * Hands the APK to Android; on success Android replaces the process. With `quiet`, an
     * install that would need the user's OK is called off instead of prompting.
     */
    suspend fun install(path: String, quiet: Boolean = false): InstallOutcome

    /** Whether Android installs this app's updates without asking: it installed itself last time. */
    fun installsSilently(): Boolean

    /** Whether the network costs by the byte. */
    fun metered(): Boolean?

    fun openUrl(url: String)

    /** Calls `listener` whenever the app comes back to the front, until closed. */
    fun onForeground(listener: () -> Unit): AutoCloseable
}

/**
 * mobile/src/remote/apk-install.ts: downloads a new APK and asks Android to
 * install it. Android asks the user to allow installs from Relay once and to
 * confirm the first update; once Relay installed itself, later updates go in
 * without a prompt (Android 12+). All calls come from the main thread.
 */
class ApkInstaller(
    private val native: ApkNative,
    private val scope: CoroutineScope,
    /** The version whose code runs; an APK older than it would be a downgrade. */
    private val pending: () -> String,
    private val warn: (String, Throwable) -> Unit = { m, e -> Log.w(TAG, m, e) },
) {
    private val _state = MutableStateFlow<ApkInstall>(ApkInstall.Idle)
    val state: StateFlow<ApkInstall> = _state.asStateFlow()
    private var current: ApkInstall
        get() = _state.value
        set(value) { _state.value = value }

    private class Fetch(val offer: ApkOffer, val path: Deferred<String?>)
    private var fetching: Fetch? = null
    private var requested: Deferred<Unit>? = null
    private var waitingForAllow: AutoCloseable? = null

    fun metered() = native.metered()

    private suspend fun download(offer: ApkOffer, quiet: Boolean): String? {
        fetching?.let { active ->
            // Asked for while it was coming down unasked: from now on it's the user's.
            val s = current
            if (!quiet && s is ApkInstall.Downloading) current = s.copy(quiet = false)
            val path = active.path.await()
            if (active.offer.version == offer.version && (offer.sha512 == null || active.offer.sha512 == offer.sha512))
                return path
            // Re-enter the native download to verify a same-version cache against the feed's checksum.
            return download(offer, quiet)
        }
        val version = offer.version
        val path = scope.async(start = CoroutineStart.LAZY) {
            current = ApkInstall.Downloading(version, 0f, quiet)
            try {
                val path = native.download(offer.url, version, offer.sha512 ?: "") { done ->
                    val s = current
                    if (s is ApkInstall.Downloading) current = s.copy(done = done)
                }
                current = ApkInstall.Downloaded(version)
                path
            } catch (e: kotlinx.coroutines.CancellationException) {
                throw e
            } catch (e: Exception) {
                val s = current
                if (s is ApkInstall.Downloading && s.quiet) {
                    warn("Couldn't download Relay $version ahead", e)
                    current = ApkInstall.Idle
                } else current = ApkInstall.Failed(version, message(e))
                null
            } finally {
                fetching = null
            }
        }
        fetching = Fetch(offer, path)
        path.start()
        return path.await()
    }

    /** Downloads the APK without installing it, so a tap later goes straight to Android's prompt. */
    fun prefetch(offer: ApkOffer) {
        val s = current
        if (s is ApkInstall.ForVersion && (s.version == offer.version || s is ApkInstall.Installing || s is ApkInstall.Allow))
            return
        scope.launch { download(offer, true) }
    }

    /** Downloads `offer` and asks Android to install it; with `browser`, the browser does. */
    suspend fun install(offer: ApkOffer, browser: Boolean = false) {
        val job = requested ?: scope.async(start = CoroutineStart.LAZY) {
            try {
                requestInstall(offer, browser)
            } catch (e: kotlinx.coroutines.CancellationException) {
                throw e
            } catch (e: Exception) {
                waitingForAllow?.close()
                waitingForAllow = null
                current = ApkInstall.Failed(offer.version, message(e))
            } finally {
                requested = null
            }
        }.also {
            requested = it
            it.start()
        }
        job.await()
    }

    private suspend fun requestInstall(offer: ApkOffer, browser: Boolean) {
        if (browser) {
            native.openUrl(offer.url)
            current = ApkInstall.Idle
            return
        }
        if (current is ApkInstall.Installing) return
        waitingForAllow?.close()
        waitingForAllow = null
        val path = download(offer, false) ?: return
        checkVersion(offer.version)
        if (native.canInstall()) return installNow(offer.version, path)
        current = ApkInstall.Allow(offer.version)
        // Carries on by itself once the user comes back with the switch on.
        waitingForAllow = native.onForeground {
            if (!native.canInstall()) return@onForeground
            waitingForAllow?.close()
            waitingForAllow = null
            scope.launch { installNow(offer.version, path) }
        }
        native.allowInstalls()
    }

    private suspend fun installNow(version: String, path: String) {
        if (current is ApkInstall.Installing) return
        try {
            checkVersion(version)
            current = ApkInstall.Installing(version)
            // "Cancelled" leaves it downloaded for the next tap.
            native.install(path)
            current = ApkInstall.Downloaded(version)
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (e: Exception) {
            current = ApkInstall.Failed(version, message(e))
        }
    }

    /**
     * Installs an update already downloaded, without asking: only when Android won't prompt,
     * so it can run with the app in the background. Android closes the app to do it.
     */
    suspend fun installQuietly(offer: ApkOffer) {
        val s = current
        if (s !is ApkInstall.Downloaded || s.version != offer.version) return
        if (requested != null || !native.canInstall() || !native.installsSilently()) return
        val path = download(offer, true) ?: return
        try {
            checkVersion(offer.version)
            current = ApkInstall.Installing(offer.version)
            native.install(path, quiet = true)
            current = ApkInstall.Downloaded(offer.version)
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (e: Exception) {
            // Unasked, so it stays quiet; the banner still offers it.
            warn("Couldn't update Relay to ${offer.version} in the background", e)
            current = ApkInstall.Downloaded(offer.version)
        }
    }

    private fun checkVersion(version: String) {
        val running = pending()
        if (newerVersion(running, version))
            throw IllegalStateException("This app would replace Relay $running with older code. Look for a new app again.")
    }

    private fun message(e: Throwable) = e.message ?: e.toString()

    private companion object { const val TAG = "ApkInstaller" }
}
