package dev.relay.android.features.readaloud

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.Base64
import java.util.concurrent.CountDownLatch
import java.util.concurrent.LinkedBlockingQueue

/** What read aloud needs from a speaker; Speaker is the real one. Calls may block briefly. */
interface SpeakerOut {
    fun start(sampleRate: Int)

    /** Queues base64 PCM, then answers how many seconds are left to play. */
    fun write(pcm: String): Double
    fun ahead(): Double

    /** Blocks until everything queued has played, or the reading stopped. */
    fun finish()
    fun stop()
}

/** Mono 16-bit little-endian PCM from base64. */
fun decodePcm(pcm: String): ShortArray {
    val bytes = Base64.getMimeDecoder().decode(pcm)
    val samples = ShortArray(bytes.size / 2)
    ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN).asShortBuffer().get(samples)
    return samples
}

/**
 * modules/relay-speaker: mono 16-bit PCM in the desktop's voice, played as it
 * arrives. Read aloud keeps a few seconds queued here and asks how far ahead
 * of the speaker it is.
 */
class Speaker : SpeakerOut {
    @Volatile private var player: Player? = null

    @Synchronized override fun start(sampleRate: Int) {
        stop()
        player = Player(sampleRate)
    }

    override fun write(pcm: String) = player?.write(pcm) ?: 0.0
    override fun ahead() = player?.ahead() ?: 0.0
    override fun finish() { player?.finish() }

    @Synchronized override fun stop() {
        player?.release()
        player = null
    }
}

private val END = ShortArray(0)

private class Player(private val rate: Int) {
    private val track: AudioTrack
    private val queue = LinkedBlockingQueue<ShortArray>()
    private val writer: Thread
    @Volatile private var released = false

    /** Frames handed over to play, not counting the silence at the end. */
    @Volatile private var queued = 0L
    @Volatile private var finishing: CountDownLatch? = null
    private val done = CountDownLatch(1)

    init {
        val min = AudioTrack.getMinBufferSize(rate, AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_16BIT)
        if (min <= 0) throw IllegalStateException("The phone can't play audio at $rate Hz.")
        track = AudioTrack.Builder()
            .setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_MEDIA)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                    .build(),
            )
            .setAudioFormat(
                AudioFormat.Builder()
                    .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                    .setSampleRate(rate)
                    .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                    .build(),
            )
            .setTransferMode(AudioTrack.MODE_STREAM)
            // Half a second; read aloud's own lead is what rides out a slow network.
            .setBufferSizeInBytes(maxOf(min, rate))
            .build()
        if (track.state != AudioTrack.STATE_INITIALIZED) {
            track.release()
            throw IllegalStateException("The speaker isn't available.")
        }
        track.play()
        writer = Thread({ run() }, "RelaySpeaker").apply { start() }
    }

    fun write(pcm: String): Double {
        val samples = decodePcm(pcm)
        if (samples.isNotEmpty() && !released && finishing == null) {
            queued += samples.size
            queue.put(samples)
        }
        return ahead()
    }

    fun ahead(): Double {
        if (released) return 0.0
        val played = try {
            track.playbackHeadPosition.toLong() and 0xffffffffL
        } catch (_: IllegalStateException) {
            return 0.0
        }
        return maxOf(0L, queued - played) / rate.toDouble()
    }

    fun finish() {
        if (released) return
        if (finishing == null) {
            finishing = done
            queue.put(END)
        }
        done.await()
    }

    private fun run() {
        try {
            while (true) {
                val samples = queue.take()
                if (samples === END) break
                if (!play(samples)) return
            }
            // A stream track starts only once it holds enough, which the tail of a
            // short reading may not; silence after it pushes the last words out.
            if (!play(ShortArray(track.bufferSizeInFrames))) return
            val until = System.nanoTime() + ((ahead() + 1) * 1e9).toLong()
            while (!released && ahead() > 0 && System.nanoTime() < until) Thread.sleep(20)
        } catch (_: InterruptedException) {
        } finally {
            done.countDown()
        }
    }

    private fun play(samples: ShortArray): Boolean {
        var at = 0
        while (at < samples.size) {
            if (released) return false
            val n = try {
                track.write(samples, at, samples.size - at, AudioTrack.WRITE_BLOCKING)
            } catch (_: IllegalStateException) {
                return false
            }
            if (n < 0) return false
            at += n
        }
        return !released
    }

    fun release() {
        released = true
        writer.interrupt()
        // Stopping wakes a write blocked on a full buffer.
        try {
            track.stop()
            track.flush()
        } catch (_: IllegalStateException) {
        }
        writer.join(500)
        track.release()
        done.countDown()
    }
}
