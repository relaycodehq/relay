package dev.relay.android.ui

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.nestedscroll.NestedScrollConnection
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalWindowInfo
import androidx.compose.ui.unit.Velocity
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog as WindowDialog
import androidx.compose.ui.window.DialogProperties
import dev.relay.android.ui.theme.Motion
import dev.relay.android.ui.theme.Radii
import dev.relay.android.ui.theme.RelayTheme

/** Android's medium window class: an unfolded Fold or a tablet. */
const val WIDE_BREAKPOINT_DP = 600

@Composable
fun rememberIsWide(): Boolean {
    val size = LocalWindowInfo.current.containerSize
    val density = LocalDensity.current
    return with(density) { size.width.toDp().value } >= WIDE_BREAKPOINT_DP
}

/**
 * Hexta's drawer: popover fill, radius 2xl on top, a grip, hairline ring and
 * a shadow. Drag down (or fling) to close; the content scrolls inside. On a
 * wide window it's a centred card instead. [halfFirst] opens a long sheet at
 * half height; scrolling its content pulls it up the rest of the way.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun Sheet(
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier,
    title: String? = null,
    description: String? = null,
    halfFirst: Boolean = false,
    content: @Composable ColumnScope.() -> Unit,
) {
    val c = RelayTheme.colors
    if (rememberIsWide()) {
        CenteredCard(onDismiss, modifier.widthIn(max = 480.dp)) {
            SheetBody(title, description, content)
        }
        return
    }
    val shape = RoundedCornerShape(topStart = Radii.xxl, topEnd = Radii.xxl)
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        // No ring: ModalBottomSheet hands the modifier to a full-window layer, so it drew a stray outline over the screen.
        modifier = modifier,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = !halfFirst),
        shape = shape,
        containerColor = c.popover,
        contentColor = c.foreground,
        tonalElevation = 0.dp,
        scrimColor = Color.Black.copy(alpha = if (c.isDark) 0.6f else 0.32f),
        dragHandle = {
            Box(Modifier.padding(top = 10.dp, bottom = 6.dp).size(36.dp, 4.dp).background(c.foreground.copy(alpha = 0.15f), RoundedCornerShape(2.dp)))
        },
    ) {
        // Held short of the top: a sheet whose content reached it bounced about a dozen times a second
        // there (the notes sheet with a long table), while one that stops short sat still. Measured
        // against the room between the bars, which the sheet adds outside this cap: 88% of the whole
        // window plus a 3-button nav bar still reached the top, and the bouncing sheet took drags from the list.
        val windowHeight = LocalWindowInfo.current.containerSize.height
        val bars = WindowInsets.safeDrawing
        val room = with(LocalDensity.current) { (windowHeight - bars.getTop(this) - bars.getBottom(this)).toDp() }
        Column(Modifier.heightIn(max = room * SHEET_MAX).navigationBarsPadding().nestedScroll(KeepUpFlingsOffSheet)) {
            SheetBody(title, description, content)
        }
    }
}

/** How much of the room between the system bars a bottom sheet's content may take. */
private const val SHEET_MAX = 0.88f

/**
 * Overscrolling the end of a sheet's list handed the leftover upward fling to the sheet, which settled
 * with it and sprang past its top for a frame. The sheet only rises on a drag, before the list scrolls,
 * so it never needs these.
 */
private val KeepUpFlingsOffSheet = object : NestedScrollConnection {
    override suspend fun onPostFling(consumed: Velocity, available: Velocity) =
        if (available.y < 0f) available else Velocity.Zero
}

@Composable
private fun SheetBody(title: String?, description: String?, content: @Composable ColumnScope.() -> Unit) {
    Column(
        Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 20.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        if (title != null || description != null) Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            if (title != null) Text(title, style = RelayTheme.type.title)
            if (description != null) Text(description, color = RelayTheme.colors.mutedForeground)
        }
        content()
    }
}

/** A card centred over a dimmed window, fading in from 96% scale. */
@Composable
fun CenteredCard(
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier,
    content: @Composable ColumnScope.() -> Unit,
) {
    val c = RelayTheme.colors
    val enter = remember { Animatable(0f) }
    LaunchedEffect(Unit) { enter.animateTo(1f, tween(Motion.BASE, easing = Motion.EaseOutQuint)) }
    WindowDialog(onDismiss, DialogProperties(usePlatformDefaultWidth = false)) {
        Box(Modifier.padding(24.dp), contentAlignment = Alignment.Center) {
            Column(
                modifier
                    .graphicsLayer {
                        alpha = enter.value
                        val s = 0.96f + 0.04f * enter.value
                        scaleX = s
                        scaleY = s
                    }
                    .shadow(24.dp, Radii.xlShape, ambientColor = Color.Black, spotColor = Color.Black)
                    .background(c.popover, Radii.xlShape)
                    .ring(c.border, Radii.xlShape),
                content = content,
            )
        }
    }
}

/**
 * Hexta's dialog: popover fill, radius xl, padding 24, a 17sp/600 title and
 * the buttons on the right.
 */
@Composable
fun Dialog(
    onDismiss: () -> Unit,
    title: String,
    modifier: Modifier = Modifier,
    description: String? = null,
    buttons: @Composable () -> Unit,
    content: (@Composable ColumnScope.() -> Unit)? = null,
) {
    CenteredCard(onDismiss, modifier.widthIn(max = 420.dp)) {
        Column(Modifier.padding(24.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(title, style = RelayTheme.type.title)
                if (description != null) Text(description, color = RelayTheme.colors.mutedForeground)
            }
            content?.invoke(this)
            Row(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End),
                verticalAlignment = Alignment.CenterVertically,
            ) { buttons() }
        }
    }
}

/** Asks before something that can't be taken back. */
@Composable
fun ConfirmDialog(
    title: String,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit,
    message: String? = null,
    confirmText: String = "Confirm",
    cancelText: String = "Cancel",
    destructive: Boolean = false,
) {
    Dialog(onDismiss, title, description = message, buttons = {
        Button(cancelText, onDismiss, variant = ButtonVariant.Outline)
        Button(
            confirmText,
            {
                onConfirm()
                onDismiss()
            },
            variant = if (destructive) ButtonVariant.Destructive else ButtonVariant.Default,
            haptic = if (destructive) Haptic.Warning else null,
        )
    })
}
