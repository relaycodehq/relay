package dev.relay.android.ui.theme

import androidx.compose.runtime.Immutable
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontVariation
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.LineHeightStyle
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import dev.relay.android.R

/** Hexta's "book" weight, a touch heavier than medium. */
val Book = FontWeight(520)

private fun inter(weight: FontWeight) = Font(
    R.font.inter_variable,
    weight = weight,
    variationSettings = FontVariation.Settings(FontVariation.weight(weight.weight)),
)

val Inter = FontFamily(
    inter(FontWeight.Normal),
    inter(Book),
    inter(FontWeight.Medium),
    inter(FontWeight.SemiBold),
    inter(FontWeight.Bold),
)

val JetBrainsMono = FontFamily(
    Font(R.font.jetbrains_mono_regular, FontWeight.Normal),
    Font(R.font.jetbrains_mono_medium, FontWeight.Medium),
)

/** Tailwind's scale shifted 1sp down: 13 is the body size. */
@Immutable
data class RelayType(
    val xs: TextStyle,
    val sm: TextStyle,
    val base: TextStyle,
    val lg: TextStyle,
    val xl: TextStyle,
    val xxl: TextStyle,
    val xxxl: TextStyle,
    val xxxxl: TextStyle,
    /** 13sp at 500: buttons, row titles, labels. */
    val label: TextStyle,
    /** 11sp at 500, muted: group headings. */
    val caption: TextStyle,
    /** 17sp at 600: dialog and sheet titles. */
    val title: TextStyle,
    /** Text fields on touch screens: 16sp, so nothing zooms or squints. */
    val input: TextStyle,
    val mono: TextStyle,
    val monoSm: TextStyle,
)

private val trim = LineHeightStyle(LineHeightStyle.Alignment.Center, LineHeightStyle.Trim.None)

private fun style(size: Int, line: Float, weight: FontWeight = FontWeight.Normal, tracking: TextUnit = 0.sp) =
    TextStyle(
        fontFamily = Inter,
        fontSize = size.sp,
        lineHeight = (size * line).sp,
        fontWeight = weight,
        letterSpacing = tracking,
        lineHeightStyle = trim,
    )

val DefaultType = RelayType(
    xs = style(11, 1.45f),
    sm = style(13, 1.5f),
    base = style(15, 1.5f),
    lg = style(17, 1.4f),
    xl = style(19, 1.35f),
    xxl = style(23, 1.3f, FontWeight.Medium, (-0.025).em),
    xxxl = style(29, 1.25f, FontWeight.Medium, (-0.025).em),
    xxxxl = style(35, 1.2f, FontWeight.Medium, (-0.025).em),
    label = style(13, 1.4f, FontWeight.Medium),
    caption = style(11, 1.4f, FontWeight.Medium),
    title = style(17, 1.35f, FontWeight.SemiBold, (-0.01).em),
    input = style(16, 1.4f),
    mono = TextStyle(fontFamily = JetBrainsMono, fontSize = 13.sp, lineHeight = 20.sp, lineHeightStyle = trim),
    monoSm = TextStyle(fontFamily = JetBrainsMono, fontSize = 11.sp, lineHeight = 16.sp, lineHeightStyle = trim),
)
