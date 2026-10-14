package dev.relay.android.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import io.github.lyxnx.compose.ui.tablericons.TablerIcons
import io.github.lyxnx.compose.ui.tablericons.outline.Check
import io.github.lyxnx.compose.ui.tablericons.outline.Search
import dev.relay.android.ui.theme.Radii
import dev.relay.android.ui.theme.RelayTheme

data class CommandItem(
    val id: String,
    val label: String,
    val icon: ImageVector? = null,
    /** Muted text on the right: a count, a path, a shortcut. */
    val hint: String? = null,
    val checked: Boolean = false,
    val enabled: Boolean = true,
)

data class CommandGroup(val heading: String?, val items: List<CommandItem>)

/**
 * Hexta's command menu: a 44dp search row over grouped, inset rows. Filters
 * by label itself unless `filter` is false (the caller filters, e.g. remotely).
 */
@Composable
fun CommandMenu(
    query: String,
    onQueryChange: (String) -> Unit,
    groups: List<CommandGroup>,
    onSelect: (CommandItem) -> Unit,
    modifier: Modifier = Modifier,
    placeholder: String = "Search",
    empty: String = "Nothing found",
    filter: Boolean = true,
    framed: Boolean = true,
) {
    val c = RelayTheme.colors
    val shown = if (!filter || query.isBlank()) groups else groups.map { g ->
        g.copy(items = g.items.filter { it.label.contains(query.trim(), ignoreCase = true) })
    }.filter { it.items.isNotEmpty() }
    Column(
        modifier
            .then(if (framed) Modifier.clip(Radii.xlShape).background(c.popover).ring(c.border, Radii.xlShape) else Modifier),
    ) {
        Row(
            Modifier.fillMaxWidth().height(44.dp).padding(horizontal = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Icon(TablerIcons.Outline.Search, null, tint = c.mutedForeground)
            BasicTextField(
                query,
                onQueryChange,
                Modifier.weight(1f),
                singleLine = true,
                textStyle = RelayTheme.type.input.copy(color = c.foreground),
                cursorBrush = SolidColor(c.foreground),
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                decorationBox = { field ->
                    Box {
                        if (query.isEmpty()) Text(placeholder, style = RelayTheme.type.input, color = c.faint)
                        field()
                    }
                },
            )
        }
        Divider()
        LazyColumn(Modifier.fillMaxWidth().padding(6.dp)) {
            if (shown.isEmpty()) item {
                Text(empty, Modifier.fillMaxWidth().padding(vertical = 20.dp), color = c.mutedForeground, textAlign = androidx.compose.ui.text.style.TextAlign.Center)
            }
            shown.forEach { group ->
                if (group.heading != null) item(key = "h:${group.heading}") {
                    Text(group.heading, Modifier.padding(horizontal = 8.dp, vertical = 6.dp), style = RelayTheme.type.caption, color = c.mutedForeground)
                }
                items(group.items, key = { "${group.heading}:${it.id}" }) { CommandRow(it) { onSelect(it) } }
            }
        }
    }
}

@Composable
private fun CommandRow(item: CommandItem, onClick: () -> Unit) {
    val c = RelayTheme.colors
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    Row(
        Modifier
            .fillMaxWidth()
            .clip(Radii.mdShape)
            .pressable(onClick, enabled = item.enabled, scale = false, interaction = interaction)
            .background(if (pressed) c.muted else androidx.compose.ui.graphics.Color.Transparent)
            .heightIn(min = 40.dp)
            .padding(horizontal = 10.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        if (item.icon != null) Icon(item.icon, null, tint = c.mutedForeground)
        Text(item.label, Modifier.weight(1f), color = if (item.enabled) c.foreground else c.faint, maxLines = 1)
        if (item.hint != null) Text(item.hint, style = RelayTheme.type.xs, color = c.faint, maxLines = 1)
        if (item.checked) Icon(TablerIcons.Outline.Check, null, tint = c.foreground)
    }
}
