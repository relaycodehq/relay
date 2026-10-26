package dev.relay.android.features.updates

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.RoundRect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathMeasure
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.unit.dp
import dev.relay.android.ui.ButtonSize
import dev.relay.android.ui.ButtonVariant
import dev.relay.android.ui.IconButton
import dev.relay.android.ui.ListGroup
import dev.relay.android.ui.ListRow
import dev.relay.android.ui.Sheet
import dev.relay.android.ui.theme.RelayTheme
import io.github.lyxnx.compose.ui.tablericons.TablerIcons
import io.github.lyxnx.compose.ui.tablericons.outline.DeviceMobile
import io.github.lyxnx.compose.ui.tablericons.outline.Download

/**
 * A newer app, offered from a corner where Settings can't be reached (the
 * pairing screen with nothing paired): a download icon with a dot, ringed by
 * a download's progress once one was asked for. Opens Settings' update rows.
 */
@Composable
fun AppUpdateButton(updates: Updates, modifier: Modifier = Modifier) {
    val latest by updates.latest.state.collectAsState()
    val apk by updates.installer.state.collectAsState()
    var open by remember { mutableStateOf(false) }
    val offer = updates.latest.offer(latest) ?: return
    // A quiet prefetch isn't something the user started, so it shows no ring.
    val progress = (apk.about(offer.version) as? ApkInstall.Downloading)?.takeIf { !it.quiet }?.done
    val c = RelayTheme.colors
    Box(modifier) {
        IconButton(
            TablerIcons.Outline.Download,
            "Update to Relay ${offer.version}",
            { open = true },
            Modifier.progressRing(progress, c.accent),
            variant = ButtonVariant.Secondary,
        )
        if (progress == null) Box(
            Modifier.align(Alignment.TopEnd).offset((-4).dp, 4.dp).size(11.dp)
                .border(2.dp, c.muted, CircleShape).padding(2.dp).background(c.accent, CircleShape),
        )
    }
    if (open) Sheet({ open = false }) {
        ListGroup {
            ListRow(
                "Relay ${updates.installed}",
                subtitle = "As installed; new versions come from GitHub.",
                leadingIcon = TablerIcons.Outline.DeviceMobile,
            )
            LatestAppRows(updates)
        }
    }
}

/** Traces the button's outline clockwise from its top-left as [progress] goes from 0 to 1. */
private fun Modifier.progressRing(progress: Float?, color: Color) = drawWithContent {
    drawContent()
    if (progress == null) return@drawWithContent
    val stroke = 2.dp.toPx()
    val inset = stroke / 2
    val radius = ButtonSize.Default.radius.toPx() - inset
    val outline = Path().apply {
        addRoundRect(RoundRect(inset, inset, size.width - inset, size.height - inset, CornerRadius(radius)))
    }
    val measure = PathMeasure().apply { setPath(outline, false) }
    val traced = Path()
    measure.getSegment(0f, measure.length * progress.coerceIn(0f, 1f), traced, true)
    drawPath(traced, color, style = Stroke(stroke))
}
