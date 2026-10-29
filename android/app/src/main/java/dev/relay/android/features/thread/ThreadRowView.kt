package dev.relay.android.features.thread

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.unit.dp
import dev.relay.android.features.diagnostics.LocalScrollTrace
import dev.relay.android.features.diagnostics.ThreadMeasurements
import dev.relay.android.features.renders.MessageRenders
import dev.relay.android.features.thread.scroll.StableGeometryState
import dev.relay.android.features.thread.scroll.readingColumn
import dev.relay.android.features.thread.scroll.stableGeometry
import dev.relay.android.remote.model.WorkspaceMove

/** The lazy row boundary owns its measurement; message state survives rows leaving the viewport. */
@Composable
internal fun ThreadRowView(
    chatId: String,
    row: ThreadMessageRow,
    root: String?,
    replies: Int,
    callbacks: MessageCallbacks,
    failures: FailureState,
    state: MessageViewState,
    geometry: StableGeometryState,
    holding: Boolean,
    measurements: ThreadMeasurements,
    workspaceMoves: List<WorkspaceMove>?,
    onView: (MessageViewing) -> Unit,
) {
    val m = row.message
    val trace = measurements.trace
    val messageTrace = remember(trace, m.id) { trace.child("message" to m.id) }
    val transient = row is ThreadMessageRow.Content && row.section in setOf(MessageSection.Header, MessageSection.Footer)
    val unfold = LocalUnfold.current
    CompositionLocalProvider(LocalScrollTrace provides messageTrace, LocalUnfold provides remember(unfold, geometry) { unfold.releasing(geometry) }) {
        Column(Modifier
            .readingColumn()
            .then(if (transient) Modifier.stableGeometry(geometry, holding) else Modifier)
            .onSizeChanged { measurements.size(row.key, it) }) {
            when (row) {
                is ThreadMessageRow.Render -> LocalThreadRemote.current?.let { remote ->
                    MessageRenders(remote, chatId, listOf(row.render), onCompose = callbacks.onCompose,
                        modifier = Modifier.padding(start = 16.dp, end = 16.dp,
                            top = if (row.ordinal == 0) 8.dp else 10.dp))
                }
                is ThreadMessageRow.Block -> MessageView(chatId, m, root, 0, callbacks, failures,
                    state = state, section = MessageSection.Body, block = row.block, onView = onView)
                is ThreadMessageRow.Content -> {
                    MessageView(chatId, m, root, replies, callbacks, failures,
                        state = state, section = row.section, onView = onView)
                    if (row.section == MessageSection.Whole || row.section == MessageSection.Footer)
                        WorkspaceMoveLine(workspaceMoves, m.id)
                }
            }
        }
    }
}

/**
 * What the reader opens or closes gives back the room the row held while they read; held, a fold they
 * closed stays a blank gap until the thread follows its end again, then goes all at once.
 */
internal fun ReaderUnfold.releasing(geometry: StableGeometryState) = ReaderUnfold { change ->
    geometry.forget()
    this(change)
}
