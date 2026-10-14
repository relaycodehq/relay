package dev.relay.android.features.markdown

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import dev.relay.android.ui.Text

/**
 * Contract stub: the markdown feature replaces the body. Renders an answer's
 * markdown; [onLink] gets every tapped link (web or a path in the thread).
 */
@Composable
fun Markdown(
    markdown: String,
    modifier: Modifier = Modifier,
    small: Boolean = false,
    onLink: (String) -> Unit = {},
) {
    Text(markdown, modifier = modifier)
}
