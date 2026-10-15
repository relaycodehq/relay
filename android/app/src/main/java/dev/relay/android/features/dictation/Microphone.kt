package dev.relay.android.features.dictation

import android.annotation.SuppressLint
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder

/** What dictation needs from a microphone; Microphone is the real one. */
interface Mic {
    /** Opens it; `onChunk` gets each 80 ms chunk on a background thread. Throws with a sentence for the user. */
    fun start(onChunk: (pcm: String, power: Double) -> Unit)

    /** Sends what's left of the last chunk, then answers how many chunks went out in all. Blocks briefly. */
    fun stop(): Int
}

private const val RATE = 16000

/** 80 ms, as the desktop's own capture hands them to the speech engine. */
private const val CHUNK = 1280

/**
 * modules/relay-mic: 16 kHz mono 16-bit PCM in 80 ms chunks, streamed to the
 * desktop's speech engine. Nothing is kept on the phone.
 */
class Microphone : Mic {
    private var recorder: AudioRecord? = null
    private var reader: Thread? = null
    @Volatile private var running = false
    @Volatile private var sent = 0

    @SuppressLint("MissingPermission") // Checked by Dictation first; a refusal throws SecurityException here.
    @Synchronized
    override fun start(onChunk: (pcm: String, power: Double) -> Unit) {
        if (running) return
        val min = AudioRecord.getMinBufferSize(RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
        val record = try {
            AudioRecord(
                // Tuned for speech recognition: no noise gate or heavy processing.
                MediaRecorder.AudioSource.VOICE_RECOGNITION,
                RATE,
                AudioFormat.CHANNEL_IN_MONO,
                AudioFormat.ENCODING_PCM_16BIT,
                maxOf(min, CHUNK * 2 * 4),
            )
        } catch (_: SecurityException) {
            throw IllegalStateException("Relay isn't allowed to use the microphone.")
        }
        if (record.state != AudioRecord.STATE_INITIALIZED) {
            record.release()
            throw IllegalStateException("The microphone isn't available.")
        }
        record.startRecording()
        if (record.recordingState != AudioRecord.RECORDSTATE_RECORDING) {
            record.release()
            throw IllegalStateException("The microphone is busy in another app.")
        }
        recorder = record
        running = true
        sent = 0
        reader = Thread({ read(record, onChunk) }, "RelayMic").apply { start() }
    }

    private fun read(record: AudioRecord, onChunk: (String, Double) -> Unit) {
        val buffer = ShortArray(CHUNK)
        var filled = 0
        while (true) {
            val n = record.read(buffer, filled, CHUNK - filled)
            if (n > 0) filled += n
            if (filled == CHUNK || (!running && filled > 0) || n < 0) {
                if (filled > 0) {
                    val (pcm, power) = encodeChunk(buffer, filled)
                    sent++
                    onChunk(pcm, power)
                }
                filled = 0
            }
            if (!running || n < 0) break
        }
    }

    @Synchronized
    override fun stop(): Int {
        val record = recorder ?: return sent
        running = false
        reader?.join(1000)
        reader = null
        recorder = null
        try {
            record.stop()
        } catch (_: IllegalStateException) {
        }
        record.release()
        return sent
    }
}
