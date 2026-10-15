package dev.relay.android.ui

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.painter.Painter
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.relay.android.ui.theme.RelayTheme

/** Initials (up to two) of a name. */
internal fun initials(name: String): String {
    val words = name.trim().split(Regex("\\s+")).filter { it.isNotEmpty() }
    return when {
        words.isEmpty() -> "?"
        words.size == 1 -> words[0].take(1).uppercase()
        else -> (words[0].take(1) + words[1].take(1)).uppercase()
    }
}

/**
 * Stable hue per project, as the desktop's cards pick it: the same 31-hash
 * over each code point's first UTF-16 unit as `for (const char of name)`.
 */
fun projectHue(name: String): Int {
    var hash = 0
    var i = 0
    while (i < name.length) {
        hash = hash * 31 + name[i].code
        i += Character.charCount(name.codePointAt(i))
    }
    return kotlin.math.abs(hash % 360)
}

/** Hexta's avatar: 24/32/40dp, muted fill, a 10% hairline ring, image or initials. */
@Composable
fun Avatar(
    name: String,
    modifier: Modifier = Modifier,
    size: Dp = 32.dp,
    image: Painter? = null,
    rounded: Boolean = false,
) {
    val c = RelayTheme.colors
    val shape = if (rounded) RoundedCornerShape(size * 0.25f) else CircleShape
    Box(
        modifier.size(size).clip(shape).background(c.muted).ring(c.foreground.copy(alpha = 0.10f), shape),
        contentAlignment = Alignment.Center,
    ) {
        if (image != null) Image(image, null, Modifier.size(size), contentScale = ContentScale.Crop)
        else Text(
            initials(name),
            style = RelayTheme.type.label.copy(fontSize = (size.value * 0.38f).sp),
            color = c.mutedForeground,
        )
    }
}

/** The project's icon if it has one, else its initial on its stable hue (the desktop's card badge). */
@Composable
fun ProjectBadge(
    name: String,
    modifier: Modifier = Modifier,
    size: Dp = 16.dp,
    icon: Painter? = null,
) {
    val shape = RoundedCornerShape(size * 0.3f)
    if (icon != null) {
        Image(icon, null, modifier.size(size).clip(shape), contentScale = ContentScale.Fit)
        return
    }
    val hue = projectHue(name).toFloat()
    Box(
        modifier.size(size).background(Color.hsl(hue, 0.45f, 0.48f), shape),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            name.trim().take(1).uppercase().ifEmpty { "?" },
            style = RelayTheme.type.label.copy(fontSize = (size.value * 0.6f).sp, lineHeight = (size.value * 0.6f).sp, fontWeight = FontWeight.Bold),
            color = Color.hsl(hue, 0.55f, 0.96f),
        )
    }
}
