package dev.relay.android.features.dictation

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * Where dictation turns speech into text: the paired computer's engine, or
 * this phone's own, which needs no computer and sends no audio. iOS's
 * DictationEngine.
 */
enum class DictationEngine { Computer, Phone }

/** The engine picked in Settings, kept on the phone. */
class DictationEngines private constructor(context: Context) {
    private val prefs = context.getSharedPreferences("relay-dictation", Context.MODE_PRIVATE)

    /** This phone has an on-device speech recognizer. */
    val available = SpeechRecognizer.isOnDeviceRecognitionAvailable(context)

    private val _picked = MutableStateFlow(
        if (prefs.getString(KEY, null) == "phone") DictationEngine.Phone else DictationEngine.Computer,
    )
    val picked: StateFlow<DictationEngine> = _picked.asStateFlow()

    fun pick(engine: DictationEngine) {
        prefs.edit().putString(KEY, engine.name.lowercase()).apply()
        _picked.value = engine
    }

    /** The phone's engine when it's picked and there is one. */
    val chosen: DictationEngine
        get() = if (available && picked.value == DictationEngine.Phone) DictationEngine.Phone else DictationEngine.Computer

    companion object {
        private const val KEY = "engine"
        @Volatile private var one: DictationEngines? = null

        fun of(context: Context): DictationEngines =
            one ?: synchronized(this) { one ?: DictationEngines(context.applicationContext).also { one = it } }
    }
}

/** A speech engine on the phone that listens on its own microphone. One per dictation; main thread only. */
interface Hearer {
    fun start(listener: Listener)

    /** Finishes; the last words come to `onEnd`. */
    fun stop()

    fun cancel()

    interface Listener {
        /** Listening; words follow. */
        fun onReady()

        /** 0–1, for the waveform. */
        fun onLevel(level: Float)

        /** Everything heard so far; `tentative` may still change. */
        fun onHeard(settled: String, tentative: String)

        fun onEnd(text: String)

        fun onError(message: String)
    }
}

/** No pause ends a dictation; Stop does. */
private const val LONG_SILENCE_MS = 10 * 60_000

/**
 * Android's on-device recognizer in a segmented session, so pauses to think
 * don't end it: each segment it settles adds to the words.
 */
class PhoneSpeech(private val context: Context) : Hearer {
    private var recognizer: SpeechRecognizer? = null
    private var settled = ""
    private var stopping = false
    private var over = false

    override fun start(listener: Hearer.Listener) {
        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
            putExtra(RecognizerIntent.EXTRA_SEGMENTED_SESSION, RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS)
            putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, LONG_SILENCE_MS)
        }
        val r = SpeechRecognizer.createOnDeviceSpeechRecognizer(context)
        recognizer = r
        fun end(text: String = settled) {
            if (over) return
            over = true
            release()
            listener.onEnd(text)
        }
        r.setRecognitionListener(object : RecognitionListener {
            override fun onReadyForSpeech(params: Bundle?) = listener.onReady()
            // Roughly -2 (quiet) to 10 dB.
            override fun onRmsChanged(rmsdB: Float) = listener.onLevel(((rmsdB + 2) / 12).coerceIn(0f, 1f))
            override fun onPartialResults(partial: Bundle) = listener.onHeard(settled, first(partial))
            override fun onSegmentResults(segment: Bundle) {
                settled = joinWords(settled, first(segment))
                listener.onHeard(settled, "")
            }
            override fun onEndOfSegmentedSession() = end()
            override fun onResults(results: Bundle) = end(joinWords(settled, first(results)))
            override fun onError(error: Int) {
                if (over) return
                // Nothing (more) was said before Stop.
                if (stopping && (error == SpeechRecognizer.ERROR_NO_MATCH || error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT))
                    return end()
                over = true
                if (error == SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE) {
                    // Android 13 queues the download on its main handler. Keep the
                    // recognizer alive until that request runs, including if the UI cancels.
                    recognizer = null
                    try {
                        r.triggerModelDownload(intent)
                    } catch (_: RuntimeException) {
                        listener.onError("The phone couldn't request its speech model. Try again, or dictate on the computer.")
                        return
                    } finally {
                        Handler(Looper.getMainLooper()).post { r.destroy() }
                    }
                } else release()
                listener.onError(describe(error))
            }
            override fun onBeginningOfSpeech() {}
            override fun onBufferReceived(buffer: ByteArray?) {}
            override fun onEndOfSpeech() {}
            override fun onEvent(eventType: Int, params: Bundle?) {}
        })
        r.startListening(intent)
    }

    override fun stop() {
        stopping = true
        recognizer?.stopListening()
    }

    override fun cancel() {
        over = true
        recognizer?.cancel()
        release()
    }

    private fun release() {
        recognizer?.destroy()
        recognizer = null
    }

    private fun first(bundle: Bundle) =
        bundle.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()?.trim().orEmpty()
}

private fun joinWords(a: String, b: String) = listOf(a, b).filter { it.isNotEmpty() }.joinToString(" ")

private fun describe(error: Int) = when (error) {
    SpeechRecognizer.ERROR_LANGUAGE_NOT_SUPPORTED ->
        "This phone's speech engine doesn't support your language. Dictate on the computer instead."
    SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE ->
        "This phone's speech engine has no model for your language yet. Android is downloading it; try again soon, or dictate on the computer."
    SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS ->
        "Relay isn't allowed to use the microphone. Allow it in Android's settings for Relay."
    SpeechRecognizer.ERROR_AUDIO -> "The microphone isn't available."
    SpeechRecognizer.ERROR_RECOGNIZER_BUSY, SpeechRecognizer.ERROR_TOO_MANY_REQUESTS ->
        "The phone's speech engine is busy in another app."
    else -> "The phone's speech engine stopped ($error)."
}
