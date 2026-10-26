package dev.relay.android.app

import android.content.Context
import androidx.core.content.edit
import dev.relay.android.remote.Remote
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow

/**
 * Relay turned off from Settings, the pairing screen or its notification: no
 * link and no tries, the ongoing notice gone, pairings and settings kept, until
 * the app is opened again. Kept on disk, so a process Android brings back for
 * something else (an update going in) stays off as well.
 */
class RelayStop(context: Context, private val remote: Remote, private val quiet: () -> Unit) {
    private val prefs = context.getSharedPreferences("relay-stop", Context.MODE_PRIVATE)
    private val _stops = MutableSharedFlow<Unit>(extraBufferCapacity = 1)

    /** Each stop, for the window to close itself. */
    val stops: SharedFlow<Unit> = _stops.asSharedFlow()

    init {
        if (prefs.getBoolean(STOPPED, false)) remote.stop()
    }

    fun stop() {
        prefs.edit { putBoolean(STOPPED, true) }
        remote.stop()
        quiet()
        _stops.tryEmit(Unit)
    }

    /** The app was opened. */
    fun resume() {
        if (!remote.stopped.value) return
        prefs.edit { putBoolean(STOPPED, false) }
        remote.resume()
    }

    private companion object {
        const val STOPPED = "stopped"
    }
}
