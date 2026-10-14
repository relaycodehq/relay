package dev.relay.android.features.thread

import androidx.compose.runtime.Composable
import dev.relay.android.ui.ListRow
import dev.relay.android.ui.RowSize
import dev.relay.android.ui.Sheet
import dev.relay.android.ui.theme.RelayTheme

data class MenuItem(
    val label: String,
    val hint: String? = null,
    val destructive: Boolean = false,
    val onPress: () -> Unit,
)

/** A list of actions in a sheet; picking one closes it first. */
@Composable
fun MenuSheet(items: List<MenuItem>, onClose: () -> Unit, title: String? = null) {
    Sheet(onDismiss = onClose, title = title) {
        for (item in items) ListRow(
            item.label,
            subtitle = item.hint,
            size = if (item.hint == null) RowSize.Sm else RowSize.Default,
            titleColor = if (item.destructive) RelayTheme.colors.destructive else RelayTheme.colors.foreground,
            onClick = {
                onClose()
                item.onPress()
            },
        )
    }
}
