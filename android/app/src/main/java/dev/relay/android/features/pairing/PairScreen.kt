package dev.relay.android.features.pairing

import android.Manifest
import android.content.ClipboardManager
import android.content.Context
import android.content.pm.PackageManager
import android.os.Handler
import android.os.Looper
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shadow
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import dev.relay.android.R
import dev.relay.android.lib.navigation.LocalNavigator
import dev.relay.android.remote.PairingLink
import dev.relay.android.remote.Remote
import dev.relay.android.remote.parsePairingUrl
import dev.relay.android.ui.Button
import dev.relay.android.ui.ButtonSize
import dev.relay.android.ui.ButtonVariant
import dev.relay.android.ui.Icon
import dev.relay.android.ui.IconButton
import dev.relay.android.ui.Text
import dev.relay.android.ui.pressable
import dev.relay.android.ui.rememberReducedMotion
import dev.relay.android.ui.theme.RelayTheme
import io.github.lyxnx.compose.ui.tablericons.TablerIcons
import io.github.lyxnx.compose.ui.tablericons.outline.Camera
import io.github.lyxnx.compose.ui.tablericons.outline.Clipboard
import io.github.lyxnx.compose.ui.tablericons.outline.ExternalLink
import io.github.lyxnx.compose.ui.tablericons.outline.X
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** shared/remote.ts's tailscaleAndroid. */
private const val TAILSCALE_PLAY = "https://play.google.com/store/apps/details?id=com.tailscale.ipn"
private const val NOT_A_CODE = "That isn't a Relay pairing code."
private const val NO_CAMERA = "Relay can't use the camera. Allow it in Android's settings for Relay, or paste the pairing link instead."

/**
 * First run, or another computer: scan the code Relay shows on the computer, as the iPhone's
 * PairingView. The field behind the words is the scanner: it folds up into the viewfinder, locks
 * onto the code, and the code bursts back into it; the computer's ring going out across it is the
 * pairing going through. A relay-remote:// link (`link`) asks before pairing.
 */
@Composable
fun PairScreen(remote: Remote, link: String?) {
    val nav = LocalNavigator.current
    val context = LocalContext.current
    val uri = LocalUriHandler.current
    val scope = rememberCoroutineScope()
    val computers by remote.computers.collectAsState()
    val firstRun = remember { computers.isEmpty() }
    var linked by remember(link) { mutableStateOf(link?.let(::parsePairingUrl)) }
    val scan = remember { PairingScan() }
    val face by scan.face.collectAsState()
    val covers by scan.cameraCovers.collectAsState()
    val reduceMotion = rememberReducedMotion()
    var pairing by remember { mutableStateOf(false) }
    /** The computer being paired with, or last paired with. */
    var name by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    /** The camera read a code that isn't Relay's. */
    var notOurs by remember { mutableStateOf(0) }

    fun pair(target: PairingLink) {
        pairing = true
        name = target.name
        error = null
        linked = null
        scan.pairingWithoutScan()
        scope.launch {
            try {
                remote.pair(target)
                scan.paired()
            } catch (e: kotlinx.coroutines.CancellationException) {
                throw e
            } catch (e: Exception) {
                error = (e.message ?: e.toString()) +
                    " Check that this phone is on the same Wi-Fi, or that Tailscale is on and signed in here."
                scan.failed()
            } finally {
                pairing = false
            }
        }
    }

    val ask = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) scan.start() else error = NO_CAMERA
    }
    DisposableEffect(scan) {
        val main = Handler(Looper.getMainLooper())
        // Called on the field's thread under the scan's lock: answer at once, act on the main thread.
        scan.onRead = { text ->
            val parsed = parsePairingUrl(text)
            main.post { if (parsed != null) pair(parsed) else notOurs++ }
            parsed != null
        }
        onDispose { scan.onRead = { false } }
    }
    LaunchedEffect(reduceMotion) { scan.reduceMotion = reduceMotion }
    LaunchedEffect(notOurs) {
        if (notOurs == 0) return@LaunchedEffect
        delay(2500)
        notOurs = 0
    }
    BackHandler(face == PairingScan.Face.Scan) { scan.close() }

    val c = RelayTheme.colors
    Box(Modifier.fillMaxSize()) {
        ScanStage(scan, cameraFailed = { error = it }, modifier = Modifier.fillMaxSize())

        BoxWithConstraints(Modifier.fillMaxSize()) {
            val hint = when (face) {
                PairingScan.Face.Scan -> if (notOurs > 0) NOT_A_CODE else "Point at the code on your computer"
                else -> "Pairing with $name…"
            }
            val shown = face == PairingScan.Face.Pairing || (face == PairingScan.Face.Scan && covers)
            Text(
                hint,
                style = RelayTheme.type.sm.copy(
                    textAlign = TextAlign.Center,
                    shadow = if (covers) Shadow(Color.Black.copy(alpha = 0.5f), blurRadius = 12f) else null,
                ),
                color = if (covers) Color.White else c.mutedForeground,
                modifier = Modifier.fillMaxWidth().padding(horizontal = 32.dp)
                    .offset(y = maxHeight * 0.623f - 10.dp)
                    .graphicsLayer { alpha = if (shown) 1f else 0f },
            )
        }

        Box(Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.safeDrawing)) {
            Welcome(face == PairingScan.Face.Idle)
            val closeShown = face == PairingScan.Face.Scan || (face == PairingScan.Face.Idle && !firstRun)
            if (closeShown) IconButton(
                TablerIcons.Outline.X,
                if (face == PairingScan.Face.Scan) "Close camera" else "Close",
                { if (face == PairingScan.Face.Scan) scan.close() else nav.pop() },
                Modifier.padding(start = 16.dp, top = 8.dp),
                variant = ButtonVariant.Secondary,
                tint = if (covers) Color.White else null,
            )

            Column(
                Modifier.align(Alignment.BottomCenter).widthIn(max = 440.dp).fillMaxWidth()
                    .padding(horizontal = 24.dp).padding(bottom = 16.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Box(contentAlignment = Alignment.TopCenter) {
                    val target = linked
                    Shown(face == PairingScan.Face.Idle, away = 18.dp) {
                        if (target != null) Copy("Pair with ${target.name}?", "On the same Wi-Fi this phone connects to it directly.", error)
                        else Copy("Pair with your computer", "On your computer, open Relay, go to Settings → Phone and scan the code shown there.", error)
                    }
                    Shown(face == PairingScan.Face.Paired, away = (-12).dp) {
                        Copy("Paired with $name", "Its threads show up here as soon as they start.", null)
                    }
                }
                Spacer(Modifier.height(40.dp))
                Box(contentAlignment = Alignment.BottomCenter) {
                    Shown(face == PairingScan.Face.Idle, away = 46.dp) {
                        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
                            val target = linked
                            if (target != null) {
                                Button("Pair", { pair(target) }, Modifier.fillMaxWidth(), size = ButtonSize.Lg, loading = pairing)
                            } else {
                                Button(
                                    "Scan code",
                                    {
                                        error = null
                                        if (cameraAllowed(context)) scan.start() else ask.launch(Manifest.permission.CAMERA)
                                    },
                                    Modifier.fillMaxWidth(),
                                    size = ButtonSize.Lg,
                                    leadingIcon = TablerIcons.Outline.Camera,
                                    enabled = !pairing,
                                )
                                Button(
                                    "Paste a pairing link",
                                    {
                                        val parsed = parsePairingUrl(clipboardText(context))
                                        if (parsed != null) pair(parsed) else error = NOT_A_CODE
                                    },
                                    Modifier.fillMaxWidth(),
                                    variant = ButtonVariant.Outline,
                                    size = ButtonSize.Lg,
                                    leadingIcon = TablerIcons.Outline.Clipboard,
                                    enabled = !pairing,
                                )
                            }
                            // Reaching the computer from outside its network takes Tailscale on both.
                            Row(
                                Modifier.pressable({ uri.openUri(TAILSCALE_PLAY) }, role = Role.Button).padding(vertical = 4.dp),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(4.dp),
                            ) {
                                Text("Away from home? ", style = RelayTheme.type.xs, color = c.mutedForeground)
                                Text("Get Tailscale", style = RelayTheme.type.xs.copy(fontWeight = FontWeight.Medium))
                                Icon(TablerIcons.Outline.ExternalLink, null, tint = c.mutedForeground, size = 12.dp)
                            }
                        }
                    }
                    Shown(face == PairingScan.Face.Paired, away = 46.dp) {
                        Button("Continue", { nav.home() }, Modifier.fillMaxWidth(), size = ButtonSize.Lg)
                    }
                }
            }
        }
    }
}

/** Who's asking, above the field, before a scan starts. */
@Composable
private fun Welcome(on: Boolean) {
    Shown(on, away = (-12).dp, Modifier.fillMaxWidth().padding(top = 8.dp)) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Image(painterResource(R.drawable.splash_mark), null, Modifier.size(56.dp))
            Text("Relay", style = RelayTheme.type.xxl.copy(fontSize = 34.sp, fontWeight = FontWeight.ExtraBold, letterSpacing = (-0.6).sp))
            Text("Your agents, in your pocket", style = RelayTheme.type.sm, color = RelayTheme.colors.mutedForeground)
        }
    }
}

@Composable
private fun Copy(title: String, text: String, error: String?) {
    Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(title, style = RelayTheme.type.xxl.copy(textAlign = TextAlign.Center))
        Text(text, style = RelayTheme.type.sm.copy(lineHeight = 20.sp, textAlign = TextAlign.Center), color = RelayTheme.colors.mutedForeground)
        if (error != null) Text(
            error,
            style = RelayTheme.type.xs.copy(textAlign = TextAlign.Center),
            color = RelayTheme.colors.destructive,
            modifier = Modifier.padding(top = 4.dp),
        )
    }
}

/** In place, or faded and slid `away` down (up when negative) and out of reach when not `on`. */
@Composable
private fun Shown(on: Boolean, away: Dp, modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    val k by animateFloatAsState(if (on) 1f else 0f, spring(dampingRatio = 0.85f, stiffness = Spring.StiffnessLow), label = "shown")
    if (k == 0f && !on) return
    Box(
        modifier.graphicsLayer {
            alpha = k
            translationY = (1 - k) * away.toPx()
        },
        contentAlignment = Alignment.Center,
    ) { content() }
}

private fun cameraAllowed(context: Context) =
    ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED

private fun clipboardText(context: Context): String {
    val clip = context.getSystemService(ClipboardManager::class.java)?.primaryClip ?: return ""
    if (clip.itemCount == 0) return ""
    return clip.getItemAt(0).coerceToText(context)?.toString() ?: ""
}
