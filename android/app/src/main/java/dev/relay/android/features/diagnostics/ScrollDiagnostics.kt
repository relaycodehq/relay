package dev.relay.android.features.diagnostics

import android.content.Context
import android.os.Build
import android.os.SystemClock
import android.util.Log
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import java.io.File
import java.util.UUID
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong

/** Bounded, non-blocking metadata recording. No message text, HTML, credentials or URLs. */
class ScrollDiagnostics private constructor(context: Context) {
    private val app = context.applicationContext
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val commands = Channel<Command>(512)
    private val dropped = AtomicInteger()
    private val sequence = AtomicLong()
    private val process = UUID.randomUUID().toString()
    private val environment: Map<String, Any?>
    private var lastAutoIncident = 0L

    private sealed interface Command {
        data class Event(val line: String) : Command
        data class Keep(val done: CompletableDeferred<Unit>?) : Command
        data class Export(val done: CompletableDeferred<File>) : Command
    }

    init {
        scope.launch {
            val files = ScrollLogFiles(File(app.filesDir, "scroll-diagnostics"))
            for (command in commands) {
                try {
                    when (command) {
                        is Command.Event -> files.append(command.line)
                        is Command.Keep -> { files.keepIncident(automatic = command.done == null); command.done?.complete(Unit) }
                        is Command.Export -> {
                            val file = File(app.cacheDir, "scroll-diagnostics.zip")
                            files.export(file, README)
                            command.done.complete(file)
                        }
                    }
                } catch (e: Exception) {
                    when (command) {
                        is Command.Keep -> command.done?.completeExceptionally(e)
                        is Command.Export -> command.done.completeExceptionally(e)
                        else -> dropped.incrementAndGet()
                    }
                    Log.w("ScrollDiagnostics", "Couldn't write scroll diagnostics", e)
                }
            }
        }
        val info = app.packageManager.getPackageInfo(app.packageName, 0)
        environment = mapOf(
            "appVersion" to info.versionName, "versionCode" to info.longVersionCode,
            "android" to Build.VERSION.SDK_INT, "device" to Build.MODEL,
            "schema" to 1, "scrollSampleMs" to 100,
        )
        event("process_start", environment)
    }

    fun trace(thread: String, computer: String?, root: String?) = ScrollTrace(this, mapOf(
        "screen" to UUID.randomUUID().toString(), "thread" to thread, "computer" to computer, "root" to root,
    ))

    internal fun event(type: String, fields: Map<String, Any?>) {
        val missed = dropped.getAndSet(0)
        val line = json(mapOf(
            "timeMs" to System.currentTimeMillis(), "uptimeMs" to SystemClock.elapsedRealtime(),
            "process" to process, "sequence" to sequence.incrementAndGet(), "event" to type, "droppedBefore" to missed,
        ) + fields).toString()
        // Leave room for one oversized manifest to fail without taking the app down.
        if (line.toByteArray().size > 64 * 1024 || commands.trySend(Command.Event(line)).isFailure)
            dropped.addAndGet(missed + 1)
    }

    /** Keep context through a suspected jump and the following second; never an unbounded incident storm. */
    fun suspect(trace: ScrollTrace, fields: Map<String, Any?>) {
        trace.event("suspected_jump", fields)
        val now = SystemClock.elapsedRealtime()
        if (lastAutoIncident != 0L && now - lastAutoIncident < 30_000) return
        lastAutoIncident = now
        scope.launch {
            delay(1000)
            commands.send(Command.Keep(null))
        }
    }

    suspend fun keepIncident() {
        val done = CompletableDeferred<Unit>()
        event("manual_incident", emptyMap())
        commands.send(Command.Keep(done))
        done.await()
    }

    suspend fun export(): File {
        event("export", environment + ("webViewVersion" to android.webkit.WebView.getCurrentWebViewPackage()?.versionName))
        val done = CompletableDeferred<File>()
        commands.send(Command.Export(done))
        return done.await()
    }

    companion object {
        @Volatile private var instance: ScrollDiagnostics? = null
        fun of(context: Context): ScrollDiagnostics = instance ?: synchronized(this) {
            instance ?: ScrollDiagnostics(context).also { instance = it }
        }
        private val README = """
            Relay Android scroll diagnostics, schema 1. Metadata only; no message bodies or HTML.
            timeMs is wall time; uptimeMs is monotonic within a boot. process and screen identify sessions.
            recent-N.jsonl runs oldest (largest N) to newest (0). Incident files overlap recent history.
            Up to 8 MiB recent history plus 3 marked and 2 automatic incidents of up to 2 MiB each.
            Total recording cap 18 MiB, across app restarts. Automatic snapshots never evict marked incidents.
            No time-based expiry. Oldest files rotate at the cap; export ZIPs are independent snapshots.
            Layout positions, viewport, measured row sizes and touch coordinates are physical pixels.
            HTML sizes and estimates explicitly ending in Dp are Compose dp / CSS pixels.
            Message metadata covers the loaded full thread, including rows outside this conversation.
            earlier is the count not yet fetched from the computer. Those messages cannot be measured here.
            Lazy rows are measured only when composed; unknown heights are null, never guessed.
            Measured heights are last observed at widthPx, not a claim that offscreen content was remeasured.
            scroll_request records app intent, never proof the request was applied. layout is the observed result.
            An observed shift without a recent request/gesture has cause=unattributed; consult adjacent sizes,
            viewport, focus, IME, touch and WebView events. The logger does not infer a cause as fact.
            Suspected jumps are heuristics: large idle anchor shifts. Up to 2 snapshots retained automatically,
            at most once per 30s, with one second of subsequent context. The last 3 manually marked snapshots
            have separate slots. Exporting does not clear recordings or incidents.
            droppedBefore > 0 means the bounded queue skipped records (or a write failed).
            When idle, no per-frame records are written. Scrolling/layout is sampled at most 10 times/second;
            gestures, size changes, pin decisions and app requests are recorded independently.
        """.trimIndent()
    }
}

class ScrollTrace internal constructor(val recorder: ScrollDiagnostics, private val fields: Map<String, Any?>) {
    fun child(vararg values: Pair<String, Any?>) = ScrollTrace(recorder, fields + values)
    fun event(type: String, vararg values: Pair<String, Any?>) = event(type, values.toMap())
    fun event(type: String, values: Map<String, Any?>) = recorder.event(type, fields + values)
}

private fun json(value: Any?): JsonElement = when (value) {
    null -> JsonNull
    is Boolean -> JsonPrimitive(value)
    is Number -> if (value.toDouble().isFinite()) JsonPrimitive(value) else JsonNull
    is String -> JsonPrimitive(value)
    is Map<*, *> -> JsonObject(value.entries.associate { it.key.toString() to json(it.value) })
    is Iterable<*> -> JsonArray(value.map(::json))
    else -> error("Unsupported diagnostic value: ${value::class.simpleName}")
}
