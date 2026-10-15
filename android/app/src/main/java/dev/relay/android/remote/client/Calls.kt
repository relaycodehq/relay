package dev.relay.android.remote.client

import dev.relay.android.remote.model.ServerFrame
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull

/** Bridge calls waiting for their answer on the current connection. Only on the client's own thread. */
internal class Calls(private val scope: CoroutineScope, private val name: () -> String) {
    private class Pending(val result: CompletableDeferred<JsonElement>, val timer: Job)

    private val pending = HashMap<Long, Pending>()
    private var next = 1L

    val waiting: Boolean get() = pending.isNotEmpty()

    /** Numbers a call, hands the number to [send] and waits up to [timeoutMs] for its result. */
    fun open(timeoutMs: Long, send: (id: Long) -> Unit): CompletableDeferred<JsonElement> {
        val id = next++
        val result = CompletableDeferred<JsonElement>()
        val timer = scope.launch {
            delay(timeoutMs)
            if (pending.remove(id) != null) result.completeExceptionally(Unanswered("${name()} didn't answer in time."))
        }
        pending[id] = Pending(result, timer)
        send(id)
        return result
    }

    /** A `result` frame. */
    fun answer(frame: ServerFrame) {
        val call = pending.remove(frame.id ?: return) ?: return
        call.timer.cancel()
        if (frame.ok == true) call.result.complete(frame.value ?: JsonNull)
        else call.result.completeExceptionally(Rejected(frame.error ?: "Relay refused that."))
    }

    /** The connection went; nothing sent on it will be answered. */
    fun failAll(reason: String) {
        for (call in pending.values) {
            call.timer.cancel()
            call.result.completeExceptionally(Unanswered(reason))
        }
        pending.clear()
    }
}
