package dev.relay.android.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.remember
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Dp

/**
 * computer: the desktop's palette and mode (Hexta neutral until it's known).
 * phone: Hexta neutral, following the phone's light or dark.
 * light / dark: Hexta neutral in that mode.
 */
enum class ThemeMode { Computer, Phone, Light, Dark }

/** The desktop's PhoneAppearance: its mode ("system", "light", "dark") and a palette per kind. */
data class DesktopAppearance(
    val mode: String,
    val light: Map<String, String>,
    val dark: Map<String, String>,
)

val LocalRelayColors = staticCompositionLocalOf { HextaDark }
val LocalRelayType = staticCompositionLocalOf { DefaultType }
val LocalHairline = staticCompositionLocalOf { Dp.Hairline }

object RelayTheme {
    val colors: RelayColors
        @Composable @ReadOnlyComposable get() = LocalRelayColors.current
    val type: RelayType
        @Composable @ReadOnlyComposable get() = LocalRelayType.current
    /** One physical pixel. */
    val hairline: Dp
        @Composable @ReadOnlyComposable get() = LocalHairline.current
    val radii get() = Radii
    val space get() = Space
}

/** Which colours a mode wears, given the desktop's appearance if it has sent one. */
fun resolveColors(mode: ThemeMode, desktop: DesktopAppearance?, systemDark: Boolean): RelayColors {
    val dark = when (mode) {
        ThemeMode.Light -> false
        ThemeMode.Dark -> true
        ThemeMode.Phone -> systemDark
        ThemeMode.Computer -> when (desktop?.mode) {
            "light" -> false
            "dark" -> true
            else -> systemDark
        }
    }
    if (mode == ThemeMode.Computer && desktop != null)
        return colorsFromDesktop(if (dark) desktop.dark else desktop.light)
    return if (dark) HextaDark else HextaLight
}

/** One palette already picked for its kind (the map carries `kind`); computer mode wears it. */
@Composable
fun RelayTheme(
    mode: ThemeMode = ThemeMode.Dark,
    desktopPalette: Map<String, String>?,
    content: @Composable () -> Unit,
) {
    val desktop = desktopPalette?.let {
        DesktopAppearance(mode = it["kind"] ?: "dark", light = it, dark = it)
    }
    RelayTheme(mode, desktop, content)
}

@Composable
fun RelayTheme(
    mode: ThemeMode = ThemeMode.Dark,
    desktop: DesktopAppearance? = null,
    content: @Composable () -> Unit,
) {
    val systemDark = isSystemInDarkTheme()
    val colors = remember(mode, desktop, systemDark) { resolveColors(mode, desktop, systemDark) }
    RelayTheme(colors, content)
}

/** Wears exactly these colours: the gallery's side-by-side themes, previews. */
@Composable
fun RelayTheme(colors: RelayColors, content: @Composable () -> Unit) {
    val density = LocalDensity.current.density
    val material = remember(colors) { materialScheme(colors) }
    CompositionLocalProvider(
        LocalRelayColors provides colors,
        LocalRelayType provides DefaultType,
        LocalHairline provides hairline(density),
    ) {
        MaterialTheme(colorScheme = material, typography = materialTypography) {
            CompositionLocalProvider(androidx.compose.material3.LocalContentColor provides colors.foreground, content = content)
        }
    }
}

/** Material underneath (ripples, selection handles, the odd M3 piece) in the same colours. */
private fun materialScheme(c: RelayColors): ColorScheme {
    val base = if (c.isDark) darkColorScheme() else lightColorScheme()
    return base.copy(
        primary = c.primary,
        onPrimary = c.onPrimary,
        secondary = c.muted,
        onSecondary = c.foreground,
        background = c.background,
        onBackground = c.foreground,
        surface = c.background,
        onSurface = c.foreground,
        surfaceVariant = c.muted,
        onSurfaceVariant = c.mutedForeground,
        surfaceContainerLow = c.card,
        surfaceContainer = c.card,
        surfaceContainerHigh = c.popover,
        outline = c.input,
        outlineVariant = c.border,
        error = c.destructive,
        onError = c.onDestructive,
        scrim = androidx.compose.ui.graphics.Color.Black,
    )
}

private val materialTypography = Typography().let { t ->
    val inter = { s: androidx.compose.ui.text.TextStyle -> s.copy(fontFamily = Inter) }
    t.copy(
        bodyLarge = DefaultType.base,
        bodyMedium = DefaultType.sm,
        bodySmall = DefaultType.xs,
        labelLarge = DefaultType.label,
        labelMedium = DefaultType.caption,
        labelSmall = DefaultType.caption,
        titleLarge = DefaultType.xl,
        titleMedium = DefaultType.lg,
        titleSmall = DefaultType.label,
        headlineSmall = inter(t.headlineSmall),
        headlineMedium = inter(t.headlineMedium),
        headlineLarge = inter(t.headlineLarge),
    )
}
