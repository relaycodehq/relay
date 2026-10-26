package dev.relay.android.ui.theme

import androidx.compose.runtime.Immutable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.compositeOver
import androidx.compose.ui.graphics.lerp

/**
 * HextaUI's tokens (shadcn neutral with hairline rings and status colours),
 * plus the few Relay needs on top: waiting, diff and the desktop's accent.
 */
@Immutable
data class RelayColors(
    val isDark: Boolean,
    val background: Color,
    val foreground: Color,
    val card: Color,
    val popover: Color,
    val primary: Color,
    val onPrimary: Color,
    /** Hexta's secondary = muted = accent: hover and quiet fills. */
    val muted: Color,
    val mutedForeground: Color,
    /** Quieter than muted text: timestamps, placeholders. */
    val faint: Color,
    /** Hairline ring around cards, popovers and lists. */
    val border: Color,
    val input: Color,
    val ring: Color,
    val selected: Color,
    val sidebar: Color,
    val destructive: Color,
    val onDestructive: Color,
    val success: Color,
    val info: Color,
    val warning: Color,
    /** The desktop's colour for threads waiting on you. */
    val waiting: Color,
    /** Links, focus, the odd brand touch; greyscale in Hexta neutral. */
    val accent: Color,
    val accentSoft: Color,
    val onAccent: Color,
    /** The desktop's Send colour; its default theme's lavender until a desktop sends its own. */
    val send: Color,
    val onSend: Color,
    val diffAddition: Color,
    val diffDeletion: Color,
    val additionText: Color,
    val deletionText: Color,
    val code: Color,
) {
    /** Hexta's hover: foreground mixed in at ~5%. */
    val hover: Color get() = foreground.copy(alpha = 0.05f).compositeOver(background)
    /** Behind a toolbar control: a shade off whatever it sits on, lighter in dark, darker in light. */
    val tool: Color get() = foreground.copy(alpha = 0.07f)
}

private val waitingColor = Color(0xFFD99A2B)

val HextaLight = RelayColors(
    isDark = false,
    background = Color(0xFFFFFFFF),
    foreground = Color(0xFF0A0A0A),
    card = Color(0xFFFFFFFF),
    popover = Color(0xFFFFFFFF),
    primary = Color(0xFF171717),
    onPrimary = Color(0xFFFAFAFA),
    muted = Color(0xFFF5F5F5),
    mutedForeground = Color(0xFF6D6D6D),
    faint = Color(0xFFA1A1A1),
    border = Color(0x1A0A0A0A),
    input = Color(0xFFE5E5E5),
    ring = Color(0xFFA1A1A1),
    selected = Color(0xFFF0F0F0),
    sidebar = Color(0xFFFAFAFA),
    destructive = Color(0xFFDC2626),
    onDestructive = Color(0xFFFAFAFA),
    success = Color(0xFF008235),
    info = Color(0xFF1F64EB),
    warning = Color(0xFFBB4D00),
    waiting = waitingColor,
    accent = Color(0xFF171717),
    accentSoft = Color(0xFFF5F5F5),
    onAccent = Color(0xFFFAFAFA),
    send = Color(0xFFAAA8E5),
    onSend = Color(0xFF1B1B22),
    diffAddition = Color(0xFFDCF5E3),
    diffDeletion = Color(0xFFFBE0E0),
    additionText = Color(0xFF008235),
    deletionText = Color(0xFFC0101C),
    code = Color(0xFFF7F7F7),
)

val HextaDark = RelayColors(
    isDark = true,
    background = Color(0xFF0A0A0A),
    foreground = Color(0xFFFAFAFA),
    card = Color(0xFF171717),
    popover = Color(0xFF171717),
    primary = Color(0xFFE5E5E5),
    onPrimary = Color(0xFF171717),
    muted = Color(0xFF262626),
    mutedForeground = Color(0xFFA1A1A1),
    faint = Color(0xFF6B6B6B),
    border = Color(0x1AFFFFFF),
    input = Color(0x26FFFFFF),
    ring = Color(0xFF737373),
    selected = Color(0xFF232323),
    sidebar = Color(0xFF171717),
    destructive = Color(0xFFFF6467),
    onDestructive = Color(0xFF171717),
    success = Color(0xFF05DF72),
    info = Color(0xFF50A2FF),
    warning = Color(0xFFFFB900),
    waiting = waitingColor,
    accent = Color(0xFFE5E5E5),
    accentSoft = Color(0xFF262626),
    onAccent = Color(0xFF171717),
    send = Color(0xFFAAA8E5),
    onSend = Color(0xFF1B1B22),
    diffAddition = Color(0xFF12321F),
    diffDeletion = Color(0xFF3A1719),
    additionText = Color(0xFF4ADE80),
    deletionText = Color(0xFFFF8A8C),
    code = Color(0xFF111111),
)

/** Parses `#rgb`, `#rrggbb` or `#rrggbbaa`; null for anything else (the desktop sends CSS-resolved hex). */
fun parseHex(value: String?): Color? {
    val hex = value?.trim()?.removePrefix("#") ?: return null
    val full = when (hex.length) {
        3 -> hex.map { "$it$it" }.joinToString("")
        6, 8 -> hex
        else -> return null
    }
    val n = full.toLongOrNull(16) ?: return null
    return if (full.length == 6) Color(0xFF000000 or n)
    else Color(((n and 0xFF) shl 24) or (n shr 8))
}

/**
 * The desktop's PhonePalette (shared/remote-models.ts: kind, sidebar, surface,
 * toolbar, inbox, text, muted, border, hover, selected, accent, accentSoft,
 * onAccent, send, onSend, diffAddition, diffDeletion) laid onto Hexta's tokens. Keys it
 * doesn't send keep Hexta's value for that kind.
 */
fun colorsFromDesktop(palette: Map<String, String>): RelayColors {
    val dark = palette["kind"] != "light"
    val base = if (dark) HextaDark else HextaLight
    fun pick(key: String) = parseHex(palette[key])
    val surface = pick("surface") ?: base.background
    val text = pick("text") ?: base.foreground
    val muted = pick("muted") ?: base.mutedForeground
    val raised = pick("inbox") ?: base.card
    val border = pick("border")
    return base.copy(
        background = surface,
        foreground = text,
        card = raised,
        popover = raised,
        primary = text,
        onPrimary = surface,
        muted = pick("hover") ?: base.muted,
        mutedForeground = muted,
        faint = lerp(surface, muted, 0.62f),
        border = border ?: base.border,
        input = border ?: base.input,
        selected = pick("selected") ?: base.selected,
        sidebar = pick("sidebar") ?: base.sidebar,
        accent = pick("accent") ?: base.accent,
        accentSoft = pick("accentSoft") ?: base.accentSoft,
        onAccent = pick("onAccent") ?: base.onAccent,
        send = pick("send") ?: pick("accent") ?: base.send,
        onSend = pick("onSend") ?: pick("onAccent") ?: base.onSend,
        diffAddition = pick("diffAddition") ?: base.diffAddition,
        diffDeletion = pick("diffDeletion") ?: base.diffDeletion,
        code = lerp(if (dark) Color.Black else text, surface, 0.9f),
    )
}
