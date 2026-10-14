package dev.relay.android.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import dev.relay.android.ui.theme.RelayColors
import dev.relay.android.ui.theme.RelayTheme

/** Status colours: the only colour Hexta uses. */
enum class Tone { Neutral, Success, Info, Warning, Destructive, Waiting }

fun Tone.color(c: RelayColors): Color = when (this) {
    Tone.Neutral -> c.mutedForeground
    Tone.Success -> c.success
    Tone.Info -> c.info
    Tone.Warning -> c.warning
    Tone.Destructive -> c.destructive
    Tone.Waiting -> c.waiting
}

enum class BadgeSize(val height: Dp, val radius: Dp) { Sm(18.dp, 5.dp), Default(20.dp, 6.dp), Lg(24.dp, 7.dp) }

/**
 * Hexta's outline badge: background fill, hairline ring, foreground text and
 * a status dot (or icon) in the tone's colour. Use sparingly: a status, not
 * decoration.
 */
@Composable
fun Badge(
    text: String,
    modifier: Modifier = Modifier,
    tone: Tone = Tone.Neutral,
    icon: ImageVector? = null,
    dot: Boolean = tone != Tone.Neutral && icon == null,
    size: BadgeSize = BadgeSize.Default,
) {
    val c = RelayTheme.colors
    val shape = RoundedCornerShape(size.radius)
    Row(
        modifier.height(size.height).background(c.background, shape).ring(c.border, shape)
            .padding(horizontal = if (size == BadgeSize.Sm) 6.dp else 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(5.dp),
    ) {
        if (icon != null) Icon(icon, null, tint = tone.color(c), size = 12.dp)
        else if (dot) Box(Modifier.size(6.dp).background(tone.color(c), CircleShape))
        Text(
            text,
            style = (if (size == BadgeSize.Lg) RelayTheme.type.sm else RelayTheme.type.xs).copy(fontWeight = RelayTheme.type.label.fontWeight),
            maxLines = 1,
        )
    }
}

/** A bare status dot, for rows where a badge would be too loud. */
@Composable
fun StatusDot(tone: Tone, modifier: Modifier = Modifier, size: Dp = 8.dp) {
    Box(modifier.size(size).background(tone.color(RelayTheme.colors), CircleShape))
}
