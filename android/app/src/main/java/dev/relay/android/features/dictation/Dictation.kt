package dev.relay.android.features.dictation

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import androidx.core.content.ContextCompat
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.ProcessLifecycleOwner
import dev.relay.android.remote.Remote
import dev.relay.android.remote.client.dictate
import dev.relay.android.remote.model.DictationHeard
import dev.relay.android.remote.model.DictationRequest
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.util.WeakHashMap
import kotlin.random.Random

/** Where the words go: the composer's text. */
interface DictationTarget {
    fun begin()

    /** Everything heard so far; `tentative` may still change. */
    fun update(settled: String, tentative: String)

    /** The final text, or null to take the words back out. */
    fun end(text: String?)
}

data class DictationState(
    val phase: Phase = Phase.Idle,
    /** Which composer is dictating, or last tried to (for its error). */
    val owner: Any? = null,
    /** The desktop is still loading the model; the audio waits for it there. */
    val loading: Boolean = false,
    val error: String? = null,
) {
    enum class Phase { Idle, Starting, Listening, Finishing }
}

typealias DictateCall = suspend (DictationRequest) -> DictationHeard

/**
 * mobile/src/remote/dictation.ts: the phone's microphone, the paired
 * desktop's speech engine. Audio goes over the encrypted link in 80 ms
 * chunks; each answer carries the words heard so far. One per process; all
 * calls on the main thread.
 */
class Dictation(
    private val mic: Mic,
    /** The link's dictate call, or null while unpaired. */
    private val call: () -> DictateCall?,
    private val permitted: () -> Boolean,
    private val scope: CoroutineScope,
    private val io: CoroutineDispatcher = Dispatchers.IO,
) {
    private val _state = MutableStateFlow(DictationState())
    val state: StateFlow<DictationState> = _state.asStateFlow()
    private var snapshot: DictationState
        get() = _state.value
        set(value) { _state.value = value }

    // Loudness goes to the waveform alone, so the composer doesn't redraw 12 times a second.
    private val _levels = MutableSharedFlow<Float>(extraBufferCapacity = 16)
    val levels: SharedFlow<Float> = _levels.asSharedFlow()

    fun hasPermission() = permitted()

    /** Read aloud stops for it; the container wires this. */
    var beforeStart: () -> Unit = {}

    private class Session(val id: Int, val target: DictationTarget, val call: DictateCall) {
        var stopRequested = false
        var heard = ""
        var received = 0
        var shown = 0
        var listening = false
    }

    private var nextId = Random.nextInt(1_000_000)
    private var session: Session? = null

    /** Starts listening into `target`. */
    fun start(target: DictationTarget, owner: Any) {
        if (snapshot.phase != DictationState.Phase.Idle) return
        val link = call()
        if (link == null) {
            snapshot = DictationState(owner = owner, error = "Not connected to your computer.")
            return
        }
        val current = Session(++nextId, target, link)
        session = current
        beforeStart()
        snapshot = DictationState(DictationState.Phase.Starting, owner, loading = true)
        scope.launch { open(current) }
    }

    private suspend fun open(current: Session) {
        var loading: Boolean
        try {
            if (!permitted()) throw IllegalStateException(
                "Relay isn't allowed to use the microphone. Allow it in Android's settings for Relay.",
            )
            loading = current.call(DictationRequest("start", current.id)).loading
            if (session !== current) return cancelRemote(current)
            current.listening = true
            withContext(io) {
                mic.start { pcm, power -> scope.launch { receive(current, pcm, power) } }
            }
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (e: Exception) {
            if (session === current) {
                discard(current)
                snapshot = snapshot.copy(phase = DictationState.Phase.Idle, loading = false, error = describe(e))
            }
            return
        }
        // Cancelled while the microphone was opening.
        if (session !== current) {
            current.listening = false
            scope.launch(io) { runCatching { mic.stop() } }
            return
        }
        current.target.begin()
        snapshot = snapshot.copy(phase = DictationState.Phase.Listening, loading = loading)
        if (current.stopRequested) stop()
    }

    private fun receive(current: Session, pcm: String, power: Double) {
        if (!current.listening) return
        val order = ++current.received
        _levels.tryEmit(loudness(power))
        scope.launch {
            try {
                show(current, order, current.call(DictationRequest("audio", current.id, pcm)))
            } catch (e: kotlinx.coroutines.CancellationException) {
                throw e
            } catch (e: Exception) {
                fail(current, e)
            }
        }
    }

    private fun show(current: Session, order: Int, heard: DictationHeard) {
        if (session !== current || order < current.shown) return
        current.shown = order
        current.heard = listOf(heard.settled, heard.tentative).filter { it.isNotEmpty() }.joinToString(" ")
        val phase = snapshot.phase
        if (phase == DictationState.Phase.Listening || phase == DictationState.Phase.Finishing)
            current.target.update(heard.settled, heard.tentative)
        if (snapshot.loading != heard.loading) snapshot = snapshot.copy(loading = heard.loading)
    }

    /** The link dropped or the engine failed: keep the words heard so far. */
    private fun fail(current: Session, error: Exception) {
        // Finishing hears the same failure from its own call.
        if (session !== current || snapshot.phase == DictationState.Phase.Finishing) return
        val was = snapshot.phase
        discard(current)
        if (was == DictationState.Phase.Listening) current.target.end(current.heard.ifEmpty { null })
        snapshot = snapshot.copy(phase = DictationState.Phase.Idle, loading = false, error = describe(error))
    }

    /** Finishes: the last words settle on the desktop, then the text stays in the composer. */
    fun stop() {
        val current = session ?: return
        when (snapshot.phase) {
            DictationState.Phase.Starting -> current.stopRequested = true
            DictationState.Phase.Listening -> {
                snapshot = snapshot.copy(phase = DictationState.Phase.Finishing)
                scope.launch { finish(current) }
            }
            else -> {}
        }
    }

    private suspend fun finish(current: Session) {
        val total = withContext(io) { runCatching { mic.stop() }.getOrDefault(current.received) }
        // The last chunk's callback can still be on its way in.
        var wait = 0
        while (current.received < total && wait++ < 25) delay(20)
        current.listening = false
        var text = current.heard
        var error: String? = null
        try {
            text = current.call(DictationRequest("stop", current.id)).settled
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (e: Exception) {
            error = describe(e)
        }
        if (session !== current) return
        session = null
        current.target.end(text.ifEmpty { null })
        snapshot = DictationState(error = error)
    }

    /** Stops and takes the dictated words back out. */
    fun cancel() {
        val current = session ?: return
        val began = snapshot.phase == DictationState.Phase.Listening || snapshot.phase == DictationState.Phase.Finishing
        discard(current)
        cancelRemote(current)
        if (began) current.target.end(null)
        snapshot = DictationState()
    }

    fun clearError() {
        snapshot = snapshot.copy(error = null)
    }

    private fun discard(current: Session) {
        if (session === current) session = null
        current.listening = false
        scope.launch(io) { runCatching { mic.stop() } }
    }

    private fun cancelRemote(current: Session) {
        scope.launch { runCatching { current.call(DictationRequest("cancel", current.id)) } }
    }

    private fun describe(e: Throwable) = e.message ?: e.toString()

    companion object {
        private val all = WeakHashMap<Remote, Dictation>()

        /** The process's dictation for `remote`, made on first use. */
        fun of(remote: Remote, context: Context): Dictation = synchronized(all) {
            all.getOrPut(remote) {
                val app = context.applicationContext
                Dictation(
                    mic = Microphone(),
                    call = { remote.client.value?.let { c -> { r: DictationRequest -> c.dictate(r) } } },
                    permitted = {
                        ContextCompat.checkSelfPermission(app, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
                    },
                    scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate),
                ).also { d ->
                    // Android takes the microphone away in the background; keep what was said.
                    // Not while starting: the permission prompt backgrounds the app too.
                    ProcessLifecycleOwner.get().lifecycle.addObserver(object : DefaultLifecycleObserver {
                        override fun onStop(owner: LifecycleOwner) {
                            if (d.state.value.phase == DictationState.Phase.Listening) d.stop()
                        }
                    })
                }
            }
        }
    }
}
