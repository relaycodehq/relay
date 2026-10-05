package expo.modules.relayspeaker

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import android.util.Base64
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.LinkedBlockingQueue

/**
 * The speaker for read aloud: mono 16-bit PCM in the desktop's voice, played
 * as it arrives. The app keeps a few seconds queued here and asks how far
 * ahead of the speaker it is.
 */
class RelaySpeakerModule : Module() {
  @Volatile private var player: Player? = null

  override fun definition() = ModuleDefinition {
    Name("RelaySpeaker")

    AsyncFunction("start") { sampleRate: Int -> start(sampleRate) }
    /** Queues base64 PCM, then answers how many seconds are left to play. */
    AsyncFunction("write") { pcm: String -> player?.write(pcm) ?: 0.0 }
    AsyncFunction("ahead") { player?.ahead() ?: 0.0 }
    /** Resolves once everything queued has played, or the reading stopped. */
    AsyncFunction("finish") { promise: Promise ->
      val current = player
      if (current == null) promise.resolve(null) else current.finish(promise)
    }
    AsyncFunction("stop") { stop() }

    OnDestroy { stop() }
  }

  @Synchronized
  private fun start(rate: Int) {
    stop()
    player = Player(rate)
  }

  @Synchronized
  private fun stop() {
    player?.release()
    player = null
  }
}

private val end = ShortArray(0)

private class Player(private val rate: Int) {
  private val track: AudioTrack
  private val queue = LinkedBlockingQueue<ShortArray>()
  private val writer: Thread
  @Volatile private var released = false
  /** Frames handed over to play, not counting the silence at the end. */
  @Volatile private var queued = 0L
  @Volatile private var finishing: Promise? = null

  init {
    val min = AudioTrack.getMinBufferSize(rate, AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_16BIT)
    if (min <= 0) throw SpeakerException("The phone can't play audio at $rate Hz.")
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
      // Half a second; the app's queue is what rides out a slow network.
      .setBufferSizeInBytes(maxOf(min, rate))
      .build()
    if (track.state != AudioTrack.STATE_INITIALIZED) {
      track.release()
      throw SpeakerException("The speaker isn't available.")
    }
    track.play()
    writer = Thread({ run() }, "RelaySpeaker").apply { start() }
  }

  fun write(pcm: String): Double {
    val bytes = Base64.decode(pcm, Base64.DEFAULT)
    val samples = ShortArray(bytes.size / 2)
    ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN).asShortBuffer().get(samples)
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

  fun finish(promise: Promise) {
    if (released || finishing != null) return promise.resolve(null)
    finishing = promise
    queue.put(end)
  }

  private fun run() {
    try {
      while (true) {
        val samples = queue.take()
        if (samples === end) break
        if (!play(samples)) return
      }
      // A stream track starts only once it holds enough, which the tail of a
      // short reading may not; silence after it pushes the last words out.
      if (!play(ShortArray(track.bufferSizeInFrames))) return
      val until = System.nanoTime() + ((ahead() + 1) * 1e9).toLong()
      while (!released && ahead() > 0 && System.nanoTime() < until) Thread.sleep(20)
    } catch (_: InterruptedException) {
    } finally {
      finishing?.resolve(null)
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
  }
}

private class SpeakerException(message: String) : CodedException("ERR_RELAY_SPEAKER", message, null)
