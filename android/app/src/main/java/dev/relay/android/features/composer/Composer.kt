package dev.relay.android.features.composer

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import dev.relay.android.remote.Remote

/**
 * Contract stub: the composer feature replaces the body. The thread screen
 * puts it at the bottom; [state] lets the thread quote into it or restore a
 * taken-back send.
 */
@Composable
fun Composer(
    remote: Remote,
    chatId: String,
    state: ComposerState,
    modifier: Modifier = Modifier,
) {
}

class ComposerState {
    var quote: (String) -> Unit = {}
    var restore: (String) -> Unit = {}
    var focus: () -> Unit = {}
}
