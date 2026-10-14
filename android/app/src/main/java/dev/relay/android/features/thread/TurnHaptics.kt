package dev.relay.android.features.thread

// The thread on screen buzzes as its turn ends or it starts asking; the
// needs-you alerts cover every other thread and deliberately skip this one.

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import dev.relay.android.features.thread.logic.TurnAnswer
import dev.relay.android.features.thread.logic.TurnFeedback
import dev.relay.android.features.thread.logic.TurnSight
import dev.relay.android.features.thread.logic.TurnWatch
import dev.relay.android.features.thread.logic.watchTurn
import dev.relay.android.remote.Remote
import dev.relay.android.remote.client.LinkState
import dev.relay.android.remote.model.ChatMessage
import dev.relay.android.remote.model.RemoteChatSummary
import dev.relay.android.ui.Haptic
import dev.relay.android.ui.rememberHaptics
import dev.relay.android.ui.rememberInFront

private class Watching {
    var observing = false
    var watch: TurnWatch? = null
}

/** Only transitions seen in the front, open thread deserve a buzz. */
@Composable
fun TurnHaptics(remote: Remote, id: String, summary: RemoteChatSummary?, answer: ChatMessage?) {
    val online = remote.status.collectAsState().value.state == LinkState.Online
    val active by remote.active.collectAsState()
    val inFront by rememberInFront()
    val haptics = rememberHaptics()
    val state = remember { Watching() }
    val latest by rememberUpdatedState(answer?.let { TurnAnswer(it.created, it.status) })

    // A baseline from a fresh snapshot whenever visibility or the connection
    // changes: cached summaries and catching up never count as transitions.
    LaunchedEffect(id, active, online, inFront) {
        state.observing = false
        state.watch = null
        if (!online || !inFront) return@LaunchedEffect
        val chat = runCatching { remote.refresh() }.getOrNull()?.chats?.find { it.id == id } ?: return@LaunchedEffect
        state.watch = watchTurn(null, TurnSight(chat.running == true, chat.runningSince, chat.waiting == true, latest)).first
        state.observing = true
    }

    val sight = summary?.let { TurnSight(it.running == true, it.runningSince, it.waiting == true, answer?.let { a -> TurnAnswer(a.created, a.status) }) }
    LaunchedEffect(sight) {
        if (!state.observing || sight == null) return@LaunchedEffect
        val (watch, feedback) = watchTurn(state.watch, sight)
        state.watch = watch
        if (feedback != null && inFront) haptics.perform(
            when (feedback) {
                TurnFeedback.Success -> Haptic.Success
                TurnFeedback.Error -> Haptic.Error
                TurnFeedback.Warning -> Haptic.Warning
            },
        )
    }
}
