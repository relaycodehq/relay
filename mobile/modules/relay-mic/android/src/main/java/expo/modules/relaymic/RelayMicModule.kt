package expo.modules.relaymic

import android.Manifest
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.util.Base64
import expo.modules.interfaces.permissions.Permissions
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.nio.ByteBuffer
import java.nio.ByteOrder

private const val rate = 16000
/** 80 ms, as the desktop's own capture hands them to the speech engine. */
private const val chunk = 1280

/**
 * The microphone for dictation: 16 kHz mono 16-bit PCM in 80 ms chunks, which
 * the app streams to the desktop's speech engine. Nothing is kept on the phone.
 */
class RelayMicModule : Module() {
  private var recorder: AudioRecord? = null
  private var reader: Thread? = null
  @Volatile private var running = false
  private var sent = 0

  override fun definition() = ModuleDefinition {
    Name("RelayMic")
    Events("onAudio")

    AsyncFunction("getPermission") { promise: Promise ->
      Permissions.getPermissionsWithPermissionsManager(
        appContext.permissions,
        promise,
        Manifest.permission.RECORD_AUDIO,
      )
    }
    AsyncFunction("requestPermission") { promise: Promise ->
      Permissions.askForPermissionsWithPermissionsManager(
        appContext.permissions,
        promise,
        Manifest.permission.RECORD_AUDIO,
      )
    }

    AsyncFunction("start") { start() }
    /** Sends what's left of the last chunk, then answers how many chunks went out in all. */
    AsyncFunction("stop") { stop() }

    OnDestroy { stop() }
  }

  @Synchronized
  private fun start() {
    if (running) return
    val min = AudioRecord.getMinBufferSize(rate, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
    val record = try {
      AudioRecord(
        // Tuned for speech recognition: no noise gate or heavy processing.
        MediaRecorder.AudioSource.VOICE_RECOGNITION,
        rate,
        AudioFormat.CHANNEL_IN_MONO,
        AudioFormat.ENCODING_PCM_16BIT,
        maxOf(min, chunk * 2 * 4),
      )
    } catch (e: SecurityException) {
      throw MicException("Relay isn't allowed to use the microphone.")
    }
    if (record.state != AudioRecord.STATE_INITIALIZED) {
      record.release()
      throw MicException("The microphone isn't available.")
    }
    record.startRecording()
    if (record.recordingState != AudioRecord.RECORDSTATE_RECORDING) {
      record.release()
      throw MicException("The microphone is busy in another app.")
    }
    recorder = record
    running = true
    sent = 0
    reader = Thread({ read(record) }, "RelayMic").apply { start() }
  }

  private fun read(record: AudioRecord) {
    val buffer = ShortArray(chunk)
    var filled = 0
    while (true) {
      val n = record.read(buffer, filled, chunk - filled)
      if (n > 0) filled += n
      if (filled == chunk || (!running && filled > 0) || n < 0) {
        if (filled > 0) emit(buffer, filled)
        filled = 0
      }
      if (!running || n < 0) break
    }
  }

  private fun emit(buffer: ShortArray, length: Int) {
    val bytes = ByteBuffer.allocate(length * 2).order(ByteOrder.LITTLE_ENDIAN)
    var sum = 0.0
    for (i in 0 until length) {
      bytes.putShort(buffer[i])
      val s = buffer[i] / 32768.0
      sum += s * s
    }
    sent++
    sendEvent(
      "onAudio",
      mapOf(
        "pcm" to Base64.encodeToString(bytes.array(), Base64.NO_WRAP),
        // Mean square, for the waveform; the app decides how loud that looks.
        "power" to sum / length,
      ),
    )
  }

  @Synchronized
  private fun stop(): Int {
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

private class MicException(message: String) : CodedException("ERR_RELAY_MIC", message, null)
