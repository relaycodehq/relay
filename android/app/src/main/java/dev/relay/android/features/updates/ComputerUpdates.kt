package dev.relay.android.features.updates

import dev.relay.android.remote.Remote
import dev.relay.android.remote.client.RemoteClient
import dev.relay.android.remote.client.computerInfo
import dev.relay.android.remote.client.updateNow
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull

/** shared/updates' UpdateState, read loosely: the computer's updater as it reports itself. */
data class UpdaterState(
    val status: String,
    val version: String? = null,
    val progress: Double = 0.0,
    val install: String? = null,
    val reason: String? = null,
    val message: String? = null,
) {
    companion object {
        fun of(json: JsonElement?): UpdaterState {
            val o = json as? JsonObject ?: return UpdaterState("off")
            fun s(key: String) = (o[key] as? JsonPrimitive)?.takeIf { it.isString }?.contentOrNull
            return UpdaterState(
                status = s("status") ?: "off",
                version = s("version"),
                progress = (o["progress"] as? JsonPrimitive)?.doubleOrNull ?: 0.0,
                install = s("install"),
                reason = s("reason"),
                message = s("message"),
            )
        }
    }
}

sealed interface ComputerUpdate {
    data object Asking : ComputerUpdate
    data class Updating(val from: String, val state: UpdaterState) : ComputerUpdate

    /** Its updater found nothing newer than what it runs. */
    data object Latest : ComputerUpdate
    data class Error(val message: String) : ComputerUpdate
}

/** Its update, in a few words. */
fun describeUpdate(name: String, update: ComputerUpdate): String = when (update) {
    ComputerUpdate.Asking -> "Asking $name to update…"
    ComputerUpdate.Latest -> "$name has the latest Relay already."
    is ComputerUpdate.Error -> {
        val m = update.message
        "Couldn't update $name: ${if (m.isNotEmpty() && m.last() !in ".!?") "$m." else m}"
    }
    is ComputerUpdate.Updating -> {
        val s = update.state
        when {
            s.status == "checking" -> "$name is looking for a new Relay…"
            s.status == "downloading" -> "$name is downloading Relay ${s.version}… ${Math.round(s.progress * 100)}%"
            s.status == "waiting" -> "$name restarts into Relay ${s.version} once its background work finishes."
            !s.version.isNullOrEmpty() -> "$name is restarting into Relay ${s.version}…"
            else -> "Updating $name…"
        }
    }
}

/**
 * mobile/src/remote/computer-update.ts: updating the paired computer's Relay
 * from the phone. The computer runs its own updater (bridge 11's updateNow)
 * and restarts into the new version; the phone watches until it comes back on
 * one. Follows the Remote's live client by itself.
 */
class ComputerUpdates(
    private val remote: Remote,
    private val scope: CoroutineScope,
    private val now: () -> Long = System::currentTimeMillis,
    private val watchMs: Long = 2_000,
    private val giveUpMs: Long = 15 * 60_000L,
) {
    private val _updates = MutableStateFlow<Map<String, ComputerUpdate>>(emptyMap())
    val updates: StateFlow<Map<String, ComputerUpdate>> = _updates.asStateFlow()

    /** Whether each computer can update itself; development builds can't. Unknown until probed. */
    private val _selfUpdating = MutableStateFlow<Map<String, Boolean>>(emptyMap())
    val selfUpdating: StateFlow<Map<String, Boolean>> = _selfUpdating.asStateFlow()

    /** The version a computer ran when its banner was waved off, for this launch. */
    private val _dismissed = MutableStateFlow<Map<String, String>>(emptyMap())
    val dismissed: StateFlow<Map<String, String>> = _dismissed.asStateFlow()

    private val timers = mutableMapOf<String, Job>()
    private val started = mutableMapOf<String, Long>()

    private class Following(val computer: String, val client: RemoteClient)
    private var following: Following? = null

    fun start() {
        scope.launch {
            combine(remote.active, remote.client) { a, c -> a to c }.distinctUntilChanged().collect { (id, client) ->
                follow(id, client)
            }
        }
        scope.launch {
            remote.overview.collect { overview ->
                val id = remote.active.value ?: return@collect
                cameBack(id, overview?.version)
            }
        }
    }

    private fun set(computer: String, update: ComputerUpdate?) {
        _updates.update { if (update != null) it + (computer to update) else it - computer }
        if (update !is ComputerUpdate.Updating && update !is ComputerUpdate.Asking) {
            timers.remove(computer)?.cancel()
            started.remove(computer)
        }
    }

    private fun settle(computer: String, from: String, state: UpdaterState) = when {
        state.status == "error" -> set(computer, ComputerUpdate.Error(state.message ?: "Its updater failed."))
        state.status == "idle" || state.status == "off" -> set(computer, ComputerUpdate.Latest)
        state.status == "available" && state.install == "manual" ->
            set(computer, ComputerUpdate.Error(state.reason ?: "Relay ${state.version} has to be installed there by hand."))
        else -> set(computer, ComputerUpdate.Updating(from, state))
    }

    fun updateComputer(computer: String, from: String, client: RemoteClient) {
        val current = _updates.value[computer]
        if (current is ComputerUpdate.Asking || current is ComputerUpdate.Updating) return
        set(computer, ComputerUpdate.Asking)
        scope.launch {
            try {
                settle(computer, from, UpdaterState.of(client.updateNow()))
            } catch (e: kotlinx.coroutines.CancellationException) {
                throw e
            } catch (e: Exception) {
                set(computer, ComputerUpdate.Error(e.message ?: e.toString()))
                return@launch
            }
            if (_updates.value[computer] !is ComputerUpdate.Updating) return@launch
            started[computer] = now()
            following?.takeIf { it.computer == computer }?.let(::watch)
        }
    }

    /** Asks how the update goes every few seconds, over this connection. */
    private fun watch(connection: Following) {
        val computer = connection.computer
        timers.remove(computer)?.cancel()
        timers[computer] = scope.launch {
            while (true) {
                delay(watchMs)
                val update = _updates.value[computer] as? ComputerUpdate.Updating ?: continue
                if (now() - (started[computer] ?: 0) > giveUpMs) {
                    set(computer, ComputerUpdate.Error("It hasn't come back on a new version. Check on it there."))
                    return@launch
                }
                // Gone quiet while it restarts; the next connection says how it went.
                val info = try {
                    connection.client.computerInfo()
                } catch (e: kotlinx.coroutines.CancellationException) {
                    throw e
                } catch (_: Exception) {
                    continue
                }
                if (following !== connection || _updates.value[computer] !== update) continue
                if (info.version != update.from) set(computer, null) else settle(computer, update.from, UpdaterState.of(info.update))
            }
        }
    }

    /**
     * The phone talks to this computer now, or to none: another computer's
     * update stops being watched, and this one's goes on over the new connection.
     */
    private fun follow(computer: String?, client: RemoteClient?) {
        following = if (computer != null && client != null) Following(computer, client) else null
        timers.values.forEach { it.cancel() }
        timers.clear()
        following?.takeIf { started.containsKey(it.computer) }?.let(::watch)
    }

    /** The computer answered on this version: an update that got it there is over. */
    private fun cameBack(computer: String, running: String?) {
        val update = _updates.value[computer]
        if (update is ComputerUpdate.Updating && running != null && running != update.from) set(computer, null)
    }

    /** Hides the banner while the computer runs this version. */
    fun dismiss(computer: String, running: String?) {
        if (running != null) _dismissed.update { it + (computer to running) }
        set(computer, null)
    }

    /** Asks once per launch whether the computer can update itself at all. */
    fun probe(computer: String, client: RemoteClient) {
        if (_selfUpdating.value.containsKey(computer)) return
        scope.launch {
            try {
                val info = client.computerInfo()
                _selfUpdating.update { it + (computer to (UpdaterState.of(info.update).status != "off")) }
            } catch (e: kotlinx.coroutines.CancellationException) {
                throw e
            } catch (_: Exception) {
            }
        }
    }
}
