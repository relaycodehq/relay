package dev.relay.android.features.readaloud

import dev.relay.android.remote.Remote
import dev.relay.android.remote.client.readAloud
import dev.relay.android.remote.model.ReadAloudAudio
import dev.relay.android.remote.model.ReadAloudRequest
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.util.WeakHashMap
import kotlin.random.Random

data class ReadAloudState(
    /** The message being read. */
    val key: String? = null,
    /** No audio yet: the desktop is loading its voice or making the first words. */
    val loading: Boolean = false,
    val error: ReadAloudError? = null,
)

data class ReadAloudError(val key: String, val message: String)

typealias ReadAloudCall = suspend (ReadAloudRequest) -> ReadAloudAudio

/** Pulls again once less than this many seconds are left to play. */
private const val LEAD = 4.0

/**
 * mobile/src/remote/read-aloud.ts: the paired desktop's voice, the phone's
 * speaker. The desktop makes the audio and keeps it until the phone pulls
 * it, a few seconds at a time, so a slow link pauses the reading instead of
 * losing it. One per process; all calls on the main thread.
 */
class ReadAloud(
    private val speaker: SpeakerOut,
    private val call: () -> ReadAloudCall?,
    private val scope: CoroutineScope,
    private val io: CoroutineDispatcher = Dispatchers.IO,
) {
    /** One at a time, so a stop can't overtake the start before it; finishing waits beside it. */
    private val serial = io.limitedParallelism(1)
    private val _state = MutableStateFlow(ReadAloudState())
    val state: StateFlow<ReadAloudState> = _state.asStateFlow()

    /** Keeps the app in the foreground while reading; the container wires these to the watch service. */
    var hold: () -> Unit = {}
    var release: () -> Unit = {}

    /** Dictation stops for it. */
    var beforeStart: () -> Unit = {}

    private class Reading(val id: Int, val key: String, val call: ReadAloudCall)

    private var nextId = Random.nextInt(1_000_000)
    private var reading: Reading? = null
    private var errorTimer: Job? = null

    /** Reads `markdown` aloud, ending any reading before it. */
    fun start(key: String, markdown: String) {
        val link = call() ?: return
        stop()
        beforeStart()
        errorTimer?.cancel()
        val current = Reading(++nextId, key, link)
        reading = current
        // Keeps pulling with the screen off; tapped on screen, so Android allows it.
        hold()
        _state.value = ReadAloudState(key, loading = true)
        scope.launch { read(current, markdown) }
    }

    private suspend fun read(current: Reading, markdown: String) {
        try {
            current.call(ReadAloudRequest("start", current.id, markdown))
            var started = false
            while (reading === current) {
                if (started && withContext(serial) { speaker.ahead() } > LEAD) {
                    delay(250)
                    continue
                }
                val audio = current.call(ReadAloudRequest("pull", current.id))
                if (reading !== current) return
                if (audio.pcm.isNotEmpty()) {
                    if (!started) withContext(serial) { speaker.start(audio.sampleRate) }
                    started = true
                    // Stopped while the speaker opened; a newer reading opens its own.
                    if (reading !== current) {
                        if (reading == null) withContext(serial) { speaker.stop() }
                        return
                    }
                    withContext(serial) { speaker.write(audio.pcm) }
                    if (_state.value.loading) _state.value = _state.value.copy(loading = false)
                }
                if (audio.done) {
                    if (started) withContext(io) { speaker.finish() }
                    break
                }
                if (audio.pcm.isEmpty()) delay(if (audio.loading) 400 else 150)
            }
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (e: Exception) {
            if (reading !== current) return
            _state.value = _state.value.copy(error = ReadAloudError(current.key, e.message ?: e.toString()))
            errorTimer = scope.launch {
                delay(5000)
                _state.value = _state.value.copy(error = null)
            }
        }
        if (reading !== current) return
        reading = null
        release()
        scope.launch(serial) { runCatching { speaker.stop() } }
        _state.value = _state.value.copy(key = null, loading = false)
    }

    fun stop() {
        val current = reading ?: return
        reading = null
        release()
        scope.launch(serial) { runCatching { speaker.stop() } }
        scope.launch { runCatching { current.call(ReadAloudRequest("stop", current.id)) } }
        _state.value = _state.value.copy(key = null, loading = false)
    }

    companion object {
        private val all = WeakHashMap<Remote, ReadAloud>()

        /** The process's read aloud for `remote`, made on first use. */
        fun of(remote: Remote): ReadAloud = synchronized(all) {
            all.getOrPut(remote) {
                ReadAloud(
                    speaker = Speaker(),
                    call = { remote.client.value?.let { c -> { r: ReadAloudRequest -> c.readAloud(r) } } },
                    scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate),
                )
            }
        }
    }
}
