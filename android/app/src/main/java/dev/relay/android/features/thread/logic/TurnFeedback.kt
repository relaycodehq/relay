package dev.relay.android.features.thread.logic

// shared/turn-feedback.ts: the buzz a phone gives for the thread on its screen.

enum class TurnFeedback { Success, Error, Warning }

data class TurnAnswer(val created: Long, val status: String)

data class TurnSight(
    val running: Boolean,
    val since: Long? = null,
    val waiting: Boolean,
    val answer: TurnAnswer? = null,
)

data class TurnWatch(
    val running: Boolean,
    val waiting: Boolean,
    val since: Long? = null,
    /** A turn that stopped running whose answer hasn't arrived finished yet: when it started. */
    val ended: Long? = null,
    /** A finished answer already present at the first look. */
    val ignoredAnswer: Long? = null,
    /** When the turn whose end already buzzed started, so it can't end twice. */
    val told: Long? = null,
)

/**
 * Compares a thread with how it last looked and says what to buzz, once per
 * change: a question appearing, or a turn ending in its answer finishing or
 * failing. With nothing to compare with it only takes note.
 */
fun watchTurn(last: TurnWatch?, sight: TurnSight): Pair<TurnWatch, TurnFeedback?> {
    var watch = TurnWatch(
        running = sight.running,
        waiting = sight.waiting,
        since = if (sight.running) sight.since ?: last?.since else null,
        ignoredAnswer = if (last != null) last.ignoredAnswer
        else sight.answer?.takeIf { it.status != "streaming" }?.created,
        told = last?.told,
    )
    if (last == null) return watch to null
    val asked = sight.waiting && !last.waiting
    var ended = if (sight.running) null else if (last.running) last.since else last.ended
    if (ended != null && ended == last.told) ended = null
    var end: TurnFeedback? = null
    val answer = sight.answer
    if (ended != null && answer != null && answer.created >= ended && answer.created != watch.ignoredAnswer && answer.status != "streaming") {
        if (answer.status == "complete") end = TurnFeedback.Success
        if (answer.status == "failed") end = TurnFeedback.Error
        watch = watch.copy(told = ended)
        ended = null
    }
    return (if (ended == null) watch else watch.copy(ended = ended)) to (if (asked) TurnFeedback.Warning else end)
}
