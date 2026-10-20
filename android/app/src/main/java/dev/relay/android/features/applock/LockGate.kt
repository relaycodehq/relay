package dev.relay.android.features.applock

import kotlinx.serialization.Serializable

/** How long Relay may be away before it asks for the PIN again. iOS: RelayKit's `LockAfter`. */
@Serializable
enum class LockAfter(val ms: Long, val label: String) {
    Immediately(0, "Right away"),
    OneMinute(60_000, "After 1 minute"),
    FiveMinutes(5 * 60_000, "After 5 minutes"),
    FifteenMinutes(15 * 60_000, "After 15 minutes"),
    OneHour(60 * 60_000, "After 1 hour"),
}

/** The lock as kept on disk: no PIN means no lock. */
@Serializable
data class LockSettings(
    val pin: StoredPin? = null,
    val biometrics: Boolean = false,
    val after: LockAfter = LockAfter.Immediately,
    /** Wrong PINs in a row, kept across restarts so killing the app doesn't reset the wait. */
    val failures: Int = 0,
    /** Wall-clock ms before which no PIN is tried. */
    val waitUntil: Long = 0,
) {
    val on get() = pin != null
}

sealed interface Attempt {
    data object Unlocked : Attempt
    data class Wrong(val failures: Int, val waitMs: Long) : Attempt
    data class Waiting(val leftMs: Long) : Attempt
}

object LockWords {
    const val PIN_LENGTH = 6

    /** Wrong PINs before each further one makes the next try wait. */
    const val FREE_TRIES = 5

    fun waitAfter(failures: Int): Long = when {
        failures < FREE_TRIES -> 0
        failures == FREE_TRIES -> 30_000
        failures == FREE_TRIES + 1 -> 60_000
        failures == FREE_TRIES + 2 -> 5 * 60_000
        failures == FREE_TRIES + 3 -> 15 * 60_000
        else -> 60 * 60_000
    }

    fun waitLine(leftMs: Long): String {
        val s = ((leftMs + 999) / 1000).coerceAtLeast(1)
        return if (s < 60) "Too many tries. Try again in ${s}s" else "Too many tries. Try again in ${(s + 59) / 60} min"
    }

    fun wrongLine(failures: Int): String =
        if (failures == FREE_TRIES - 1) "Wrong PIN. One more and Relay makes you wait." else "Wrong PIN"
}

/**
 * When Relay locks, in memory and on a monotonic clock: a cold start is locked, leaving starts
 * the clock, coming back past [LockSettings.after] locks. A trip Relay sent the reader on itself
 * (a photo picker, the camera) doesn't count, unless it lasts past [OWN_TRIP_MS].
 */
class LockGate(on: Boolean) {
    var locked = on
        private set
    private var awaySince: Long? = null
    private var ownTripAt: Long? = null

    fun lock() {
        locked = true
    }

    fun unlock() {
        locked = false
    }

    fun ownTrip(now: Long) {
        ownTripAt = now
    }

    /**
     * The trip's result came back. Too short for Relay to stop, no [back] clears the trip, so this
     * does; away, the result can come before [back], which still needs it.
     */
    fun ownTripOver() {
        if (awaySince == null) ownTripAt = null
    }

    fun left(settings: LockSettings, now: Long) {
        if (!settings.on) return
        awaySince = now
        if (settings.after == LockAfter.Immediately && ownTripAt == null) locked = true
    }

    fun back(settings: LockSettings, now: Long) {
        val since = awaySince ?: return
        val trip = ownTripAt
        awaySince = null
        ownTripAt = null
        if (!settings.on || locked) return
        if (trip != null && now - trip < OWN_TRIP_MS) return
        if (now - since >= settings.after.ms) locked = true
    }

    companion object {
        const val OWN_TRIP_MS = 10 * 60_000L

        /** A PIN tried at wall time [now]: the settings to keep and what happened. */
        fun attempt(settings: LockSettings, matches: Boolean, now: Long): Pair<LockSettings, Attempt> {
            if (settings.waitUntil > now) return settings to Attempt.Waiting(settings.waitUntil - now)
            if (matches) return settings.copy(failures = 0, waitUntil = 0) to Attempt.Unlocked
            val failures = settings.failures + 1
            val wait = LockWords.waitAfter(failures)
            return settings.copy(failures = failures, waitUntil = if (wait > 0) now + wait else 0) to Attempt.Wrong(failures, wait)
        }
    }
}
