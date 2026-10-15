package dev.relay.android.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.github.lyxnx.compose.ui.tablericons.TablerIcons
import io.github.lyxnx.compose.ui.tablericons.outline.ChevronRight
import dev.relay.android.ui.theme.Radii
import dev.relay.android.ui.theme.RelayTheme
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.sp

/*
 * Lists look like Home's: rows sit 8dp in from the screen's edges ([ListInset]),
 * each a rounded patch that lights up when pressed, with a quiet label over
 * each group. No cards, no rules between rows.
 */

/** How far a list's rows sit in from the screen's edges; a screen pads its list with it. */
val ListInset = 8.dp

/** A screen's list: [ListInset] at the sides, [bottom] below the last row. */
fun listPadding(bottom: Dp = 40.dp, top: Dp = 4.dp) = PaddingValues(start = ListInset, end = ListInset, top = top, bottom = bottom)

/** Rows' text starts this far inside them, so it lines up with group labels. */
private val ROW_PAD = 12.dp
private val ROW_SHAPE = RoundedCornerShape(12.dp)

/** A group's label: 11sp, 500, muted, with how many it holds in faint on the right. */
@Composable
fun SectionHeader(
    text: String,
    modifier: Modifier = Modifier,
    count: Int? = null,
    action: (@Composable () -> Unit)? = null,
) {
    val c = RelayTheme.colors
    Row(
        modifier.fillMaxWidth().heightIn(min = 34.dp).padding(start = ROW_PAD, end = ROW_PAD, top = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text(text, Modifier.weight(1f), style = RelayTheme.type.xs.copy(fontWeight = FontWeight.Medium), color = c.mutedForeground, maxLines = 1)
        if (count != null) Text("$count", style = RelayTheme.type.xs, color = c.faint)
        if (action != null) action()
    }
}

/** Rows of one group, stacked with Home's 2dp between them. */
@Composable
fun ListGroup(modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(2.dp)) { content() }
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

/** Default rows are a thread row's height; Sm and Xs are for menus and dense lists. */
enum class RowSize(val minHeight: Dp, val padY: Dp) { Default(52.dp, 9.dp), Sm(44.dp, 7.dp), Xs(36.dp, 5.dp) }

/**
 * A list row as Home draws a thread: a 16dp glyph, a 14sp title, a muted
 * line under it, then whatever trails. Pressed it lights up in hover;
 * `selected` keeps it lit.
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
        pressed -> c.hover
        selected -> c.selected
        else -> Color.Transparent
    }
    Row(
        modifier
            .fillMaxWidth()
            .clip(ROW_SHAPE)
            .semantics { this.selected = selected }
            .background(fill)
            .then(
                if (onClick != null || onLongClick != null)
                    Modifier.pressable(onClick ?: {}, onLongClick = onLongClick, scale = false, interaction = interaction)
                else Modifier,
            )
            .heightIn(min = size.minHeight)
            .padding(horizontal = ROW_PAD, vertical = size.padY),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        when {
            leading != null -> Box(Modifier.widthIn(min = 16.dp), contentAlignment = Alignment.Center) { leading() }
            leadingIcon != null -> Icon(leadingIcon, null, tint = c.mutedForeground, size = 16.dp)
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(
                title,
                style = RelayTheme.type.base.copy(fontSize = 14.sp, fontWeight = FontWeight.Medium),
                color = titleColor,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            if (subtitle != null) Text(subtitle, style = RelayTheme.type.xs, color = c.mutedForeground, maxLines = subtitleLines, overflow = TextOverflow.Ellipsis)
        }
        if (trailing != null) trailing()
        if (chevron) Icon(TablerIcons.Outline.ChevronRight, null, tint = c.faint, size = 14.dp)
    }
}
