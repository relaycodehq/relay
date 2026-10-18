package dev.relay.android.features.thread.logic

// Room for the request card in a thread: the screen less the keyboard, the bar above and the
// composer below, so a question never squeezes the composer out or hides behind the keyboard.

private const val CHROME_DP = 56f + 24f + 130f + 24f // top bar, status bar, composer, a sliver of thread
private const val MIN_DP = 200f
private const val SHARE = 0.6f

fun requestCardMaxHeightDp(screenDp: Float, keyboardDp: Float): Float {
    val room = screenDp - keyboardDp - CHROME_DP
    return room.coerceIn(MIN_DP, screenDp * SHARE)
}
