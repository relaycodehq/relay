package dev.relay.android.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.github.lyxnx.compose.ui.tablericons.TablerIcons
import io.github.lyxnx.compose.ui.tablericons.outline.ChevronRight
import dev.relay.android.ui.theme.Radii
import dev.relay.android.ui.theme.RelayTheme

/** A group heading above a list: 11sp, 500, muted. */
@Composable
fun SectionHeader(
    text: String,
    modifier: Modifier = Modifier,
    action: (@Composable () -> Unit)? = null,
) {
    Row(
        modifier.fillMaxWidth().padding(start = 4.dp, end = 4.dp, top = 16.dp, bottom = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(text, Modifier.weight(1f), style = RelayTheme.type.caption, color = RelayTheme.colors.mutedForeground)
        if (action != null) action()
    }
}

/**
 * One card holding rows, with a hairline between each. Children are stacked
 * as they are; any composable works as a row, ListRow is the usual one.
 */
@Composable
fun ListGroup(
    modifier: Modifier = Modifier,
    dividerInset: Dp = 0.dp,
    content: @Composable () -> Unit,
) {
    val c = RelayTheme.colors
    val line = RelayTheme.hairline
    val edges = remember { IntArray(64) }
    val count = remember { IntArray(1) }
    Layout(
        content = content,
        modifier = modifier
            .clip(Radii.xlShape)
            .background(c.card)
            .ring(shape = Radii.xlShape)
            .drawWithContent {
                drawContent()
                val w = line.toPx()
                val inset = dividerInset.toPx()
                for (i in 0 until count[0]) {
                    val y = edges[i].toFloat() - w / 2
                    drawLine(c.border, Offset(inset, y), Offset(size.width, y), w)
                }
            },
    ) { measurables, constraints ->
        val loose = constraints.copy(minHeight = 0, maxHeight = androidx.compose.ui.unit.Constraints.Infinity)
        val placeables = measurables.map { it.measure(loose) }
        val width = placeables.maxOfOrNull { it.width }?.coerceAtLeast(constraints.minWidth) ?: constraints.minWidth
        val height = placeables.sumOf { it.height }
        layout(width, height.coerceIn(constraints.minHeight, constraints.maxHeight)) {
            var y = 0
            var n = 0
            placeables.forEachIndexed { i, p ->
                p.placeRelative(0, y)
                y += p.height
                if (i < placeables.lastIndex && p.height > 0 && n < edges.size) edges[n++] = y
            }
            count[0] = n
        }
    }
}

/** Hexta's 40dp item media: an icon on a muted tile. */
@Composable
fun MediaTile(
    icon: ImageVector,
    modifier: Modifier = Modifier,
    size: Dp = 40.dp,
    tint: Color = RelayTheme.colors.foreground,
) {
    Box(
        modifier.size(size).clip(Radii.lgShape).background(RelayTheme.colors.muted)
            .ring(RelayTheme.colors.foreground.copy(alpha = 0.05f), Radii.lgShape),
        contentAlignment = Alignment.Center,
    ) { Icon(icon, null, tint = tint, size = if (size >= 40.dp) 18.dp else 16.dp) }
}

enum class RowSize(val padX: Dp, val padY: Dp) { Default(16.dp, 14.dp), Sm(12.dp, 10.dp), Xs(10.dp, 8.dp) }

/**
 * A list row: leading media, a title (13sp, 500), a muted subtitle, then
 * whatever trails. Pressed rows highlight in muted; `selected` keeps it.
 */
@Composable
fun ListRow(
    title: String,
    modifier: Modifier = Modifier,
    subtitle: String? = null,
    leadingIcon: ImageVector? = null,
    leading: (@Composable () -> Unit)? = null,
    trailing: (@Composable () -> Unit)? = null,
    chevron: Boolean = false,
    selected: Boolean = false,
    size: RowSize = RowSize.Default,
    titleColor: Color = RelayTheme.colors.foreground,
    subtitleLines: Int = 2,
    onClick: (() -> Unit)? = null,
    onLongClick: (() -> Unit)? = null,
) {
    val c = RelayTheme.colors
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    val fill = when {
        pressed -> c.muted.copy(alpha = 0.6f)
        selected -> c.muted
        else -> Color.Transparent
    }
    Row(
        modifier
            .fillMaxWidth()
            .semantics { this.selected = selected }
            .then(
                if (onClick != null || onLongClick != null)
                    Modifier.pressable(onClick ?: {}, onLongClick = onLongClick, scale = false, interaction = interaction)
                else Modifier,
            )
            .background(fill)
            .heightIn(min = 44.dp)
            .padding(horizontal = size.padX, vertical = size.padY),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        when {
            leading != null -> leading()
            leadingIcon != null -> MediaTile(leadingIcon, size = if (size == RowSize.Default) 40.dp else 32.dp)
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(title, style = RelayTheme.type.label, color = titleColor, maxLines = 1)
            if (subtitle != null) Text(subtitle, color = c.mutedForeground, maxLines = subtitleLines)
        }
        if (trailing != null) trailing()
        if (chevron) {
            Spacer(Modifier.width(0.dp))
            Icon(TablerIcons.Outline.ChevronRight, null, tint = c.faint)
        }
    }
}
