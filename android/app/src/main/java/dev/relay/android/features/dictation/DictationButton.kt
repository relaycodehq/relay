package dev.relay.android.features.dictation

import android.Manifest
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import dev.relay.android.remote.Remote
import dev.relay.android.ui.Haptic
import dev.relay.android.ui.rememberHaptics
import dev.relay.android.ui.rememberReducedMotion
import dev.relay.android.ui.theme.RelayTheme
import io.github.lyxnx.compose.ui.tablericons.TablerIcons
import io.github.lyxnx.compose.ui.tablericons.outline.Microphone

/** How long the capsule takes to shrink back into the mic. */
const val DICTATION_SHRINK_MS = 220

/** Held longer than this, the mic is push-to-talk and letting go finishes. */
private const val HOLD_MS = 350L
private const val BARS = 14
private val IdleWidth = 34.dp
private val LiveWidth = 120.dp

/** Whether the computer can take dictation: desktops from before phone dictation don't say, and can't. */
@Composable
fun canDictate(remote: Remote): Boolean {
    val overview by remote.overview.collectAsState()
    val engines = DictationEngines.of(LocalContext.current)
    val picked by engines.picked.collectAsState()
    if (engines.available && picked == DictationEngine.Phone) return true
    val d = overview?.dictation
    return d != null && d != "unsupported"
}

/**
 * The composer's mic, as on the desktop: tap to start and stop, or hold to
 * talk and let go to finish. While listening it widens into the live
 * waveform with a small square that says tapping finishes. `owner` tells
 * this composer's session from another's; `target` is where the words go.
 */
@Composable
fun DictationButton(
    remote: Remote,
    owner: Any,
    target: () -> DictationTarget,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
) {
    val context = LocalContext.current
    val dictation = remember(remote) { Dictation.of(remote, context) }
    val session by dictation.state.collectAsState()
    val haptics = rememberHaptics()
    val reduced = rememberReducedMotion()
    val c = RelayTheme.colors
    val mine = session.owner === owner && session.phase != DictationState.Phase.Idle
    val listening = mine && session.phase == DictationState.Phase.Listening

    val currentTarget by rememberUpdatedState(target)
    val start = {
        haptics.perform(Haptic.Light)
        dictation.start(currentTarget(), owner)
    }
    // Android's prompt first; a refusal reaches Dictation, which says so.
    val ask = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { start() }

    val width by animateDpAsState(
        if (mine) LiveWidth else IdleWidth,
        when {
            reduced -> tween(0)
            mine -> spring(dampingRatio = 0.55f, stiffness = Spring.StiffnessMedium)
            else -> tween(DICTATION_SHRINK_MS)
        },
        label = "mic",
    )
    val live by animateFloatAsState(if (mine) 1f else 0f, tween(if (reduced) 0 else 200), label = "live")

    val levels = remember { mutableStateListOf<Float>().apply { repeat(BARS) { add(0f) } } }
    LaunchedEffect(listening) {
        for (i in 0 until BARS) levels[i] = 0f
        if (!listening) return@LaunchedEffect
        dictation.levels.collect { level ->
            levels.removeAt(0)
            levels.add(level)
        }
    }

    Box(
        modifier
            .padding(start = 4.dp)
            .width(width)
            .height(34.dp)
            .clip(RoundedCornerShape(17.dp))
            .alpha(if (!enabled && !mine) 0.4f else 1f)
            .semantics {
                role = Role.Button
                contentDescription = if (mine) "Finish dictation" else "Dictate"
            }
            .pointerInput(enabled, mine, owner) {
                detectTapGestures(onPress = {
                    if (!enabled && !mine) return@detectTapGestures
                    val idle = dictation.state.value.phase == DictationState.Phase.Idle
                    val at = System.currentTimeMillis()
                    if (idle) {
                        if (dictation.hasPermission()) start() else ask.launch(Manifest.permission.RECORD_AUDIO)
                    }
                    tryAwaitRelease()
                    // A tap on the live capsule finishes; so does letting go after holding.
                    if (!idle || System.currentTimeMillis() - at >= HOLD_MS) {
                        haptics.perform(Haptic.Light)
                        dictation.stop()
                    }
                })
            },
        contentAlignment = Alignment.CenterStart,
    ) {
        Box(Modifier.matchParentSize().alpha(live).background(c.accentSoft))
        Box(
            Modifier.size(IdleWidth).graphicsLayer {
                alpha = 1 - live
                scaleX = 1 - 0.6f * live
                scaleY = 1 - 0.6f * live
            },
            contentAlignment = Alignment.Center,
        ) {
            Icon(TablerIcons.Outline.Microphone, null, Modifier.size(17.dp), tint = c.mutedForeground)
        }
        Row(
            Modifier.padding(start = 12.dp).height(20.dp).alpha(live),
            horizontalArrangement = Arrangement.spacedBy(2.5.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            val color = if (mine && !session.loading) c.accent else c.mutedForeground
            levels.forEachIndexed { i, level ->
                val height by animateFloatAsState(
                    0.12f + 0.88f * level,
                    if (reduced) tween(0) else spring(dampingRatio = 0.4f, stiffness = 260f),
                    label = "bar",
                )
                Box(
                    Modifier.width(3.dp).fillMaxHeight()
                        .graphicsLayer {
                            scaleY = height
                            // Older bars fade toward the left edge.
                            alpha = 0.35f + 0.65f * i / (BARS - 1)
                        }
                        .background(color, RoundedCornerShape(1.5.dp)),
                )
            }
        }
        Box(
            Modifier.align(Alignment.CenterEnd).padding(end = 12.dp).size(9.dp)
                .graphicsLayer { alpha = live; scaleX = live; scaleY = live }
                .background(c.accent, RoundedCornerShape(2.5.dp)),
        )
    }
}
