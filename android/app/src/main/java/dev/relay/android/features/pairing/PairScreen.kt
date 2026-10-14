package dev.relay.android.features.pairing

import android.Manifest
import android.content.ClipboardManager
import android.content.Context
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.semantics.Role
import dev.relay.android.ui.ButtonSize
import dev.relay.android.ui.Icon
import dev.relay.android.ui.pressable
import dev.relay.android.ui.ring
import io.github.lyxnx.compose.ui.tablericons.outline.DeviceDesktop
import io.github.lyxnx.compose.ui.tablericons.outline.Qrcode
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import dev.relay.android.lib.navigation.LocalNavigator
import dev.relay.android.lib.navigation.backAction
import dev.relay.android.remote.PairingLink
import dev.relay.android.remote.Remote
import dev.relay.android.remote.parsePairingUrl
import dev.relay.android.ui.Button
import dev.relay.android.ui.ButtonVariant
import dev.relay.android.ui.Screen
import dev.relay.android.ui.Spinner
import dev.relay.android.ui.Text
import dev.relay.android.ui.theme.Radii
import dev.relay.android.ui.theme.RelayTheme
import io.github.lyxnx.compose.ui.tablericons.TablerIcons
import io.github.lyxnx.compose.ui.tablericons.outline.Clipboard
import io.github.lyxnx.compose.ui.tablericons.outline.ExternalLink
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** shared/remote.ts's tailscaleAndroid. */
private const val TAILSCALE_PLAY = "https://play.google.com/store/apps/details?id=com.tailscale.ipn"
private const val NOT_A_CODE = "That isn't a Relay pairing code."

/**
 * mobile/src/app/pair.tsx: pairs from the QR code in Relay's Settings → Phone,
 * a pasted link, or a relay-remote:// deep link (`link`). On the same Wi-Fi
 * the phone needs nothing else; Tailscale, for reaching the computer from
 * elsewhere, comes last and optional.
 */
@Composable
fun PairScreen(remote: Remote, link: String?) {
    val nav = LocalNavigator.current
    val context = LocalContext.current
    val uri = LocalUriHandler.current
    val scope = rememberCoroutineScope()
    val computers by remote.computers.collectAsState()
    val linked = remember(link) { link?.let(::parsePairingUrl) }
    var busy by remember { mutableStateOf<String?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var scanned by remember { mutableStateOf(false) }
    var rescan by remember { mutableStateOf(0) }
    var camera by remember { mutableStateOf(cameraAllowed(context)) }
    var cameraRefused by remember { mutableStateOf(false) }
    val ask = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        camera = granted
        cameraRefused = !granted
    }

    fun pair(target: PairingLink) {
        busy = "Pairing with ${target.name}…"
        error = null
        scope.launch {
            try {
                remote.pair(target)
                // A deep link opens pairing on top of home; go back to it, not over it.
                nav.home()
            } catch (e: kotlinx.coroutines.CancellationException) {
                throw e
            } catch (e: Exception) {
                error = e.message ?: e.toString()
                scanned = false
                busy = null
            }
        }
    }

    fun read(text: String) {
        val parsed = parsePairingUrl(text)
        if (parsed != null) pair(parsed) else error = NOT_A_CODE
    }

    // A code that isn't Relay's: look again in a moment.
    LaunchedEffect(rescan) {
        if (rescan == 0) return@LaunchedEffect
        delay(1500)
        scanned = false
    }

    val c = RelayTheme.colors
    val hint = RelayTheme.type.sm.copy(lineHeight = 20.sp)
    val firstRun = computers.isEmpty()
    val pending = busy
    // The first computer: nothing behind this screen but leaving the app, so no bar and no arrow.
    Screen("Pair another computer", onBack = nav.backAction, topBar = !firstRun) {
        Column(
            Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState()),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Column(
                Modifier.widthIn(max = 440.dp).fillMaxWidth().padding(horizontal = 24.dp)
                    .padding(top = if (firstRun) 40.dp else 12.dp, bottom = 24.dp),
            ) {
                Text(
                    when {
                        linked != null -> "Pair with ${linked.name}?"
                        firstRun -> "Pair with your computer"
                        else -> "Scan its pairing code"
                    },
                    style = RelayTheme.type.xxl,
                )
                Spacer(Modifier.height(6.dp))
                Text(
                    if (linked != null) "On the same Wi-Fi this phone connects to it directly."
                    else "Relay on your computer shows a code. Scan it and this phone drives its agents.",
                    style = hint,
                    color = c.mutedForeground,
                )
                Spacer(Modifier.height(28.dp))
                Viewfinder(
                    onClick = if (!camera && pending == null && linked == null) ({ ask.launch(Manifest.permission.CAMERA) }) else null,
                    modifier = Modifier.align(Alignment.CenterHorizontally).widthIn(max = 340.dp).fillMaxWidth(),
                ) {
                    when {
                        pending != null -> Centered {
                            Spinner(size = 20.dp, color = c.mutedForeground)
                            Text(pending, style = hint, color = c.mutedForeground)
                        }
                        linked != null -> Centered {
                            Icon(TablerIcons.Outline.DeviceDesktop, null, tint = c.mutedForeground, size = 36.dp)
                            Text(linked.name, style = RelayTheme.type.label)
                        }
                        camera -> QrScanner(
                            onCode = { data ->
                                if (!scanned) {
                                    scanned = true
                                    val parsed = parsePairingUrl(data)
                                    if (parsed != null) pair(parsed)
                                    else {
                                        error = NOT_A_CODE
                                        rescan++
                                    }
                                }
                            },
                            modifier = Modifier.fillMaxSize(),
                        )
                        else -> Centered {
                            Icon(TablerIcons.Outline.Qrcode, null, tint = c.mutedForeground, size = 36.dp)
                            Text("Tap to scan", style = RelayTheme.type.label)
                            Text("Relay asks for the camera once", style = RelayTheme.type.xs, color = c.mutedForeground)
                        }
                    }
                }
                val problem = error ?: if (cameraRefused && !camera && pending == null && linked == null)
                    "Relay can't use the camera. Allow it in Android's settings for Relay, or paste the link instead." else null
                if (problem != null) {
                    Spacer(Modifier.height(14.dp))
                    Text(
                        problem + if (error == null || problem.startsWith("That isn't")) ""
                        else " Check that this phone is on the same Wi-Fi, or that Tailscale is on and signed in here.",
                        style = hint,
                        color = if (error != null) c.destructive else c.mutedForeground,
                    )
                }
                if (linked == null) {
                    Spacer(Modifier.height(28.dp))
                    Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
                        Step(1, "Open Relay on your computer")
                        Step(2, "Settings → Phone → Show pairing code")
                        Step(3, "Point this phone at the code")
                    }
                }
            }
        }
        Column(
            Modifier.align(Alignment.CenterHorizontally).widthIn(max = 440.dp).fillMaxWidth()
                .padding(horizontal = 24.dp).padding(top = 8.dp, bottom = 16.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            when {
                linked != null -> Button("Pair", { pair(linked) }, Modifier.fillMaxWidth(), size = ButtonSize.Lg, loading = pending != null)
                pending == null -> Button(
                    "Paste pairing link",
                    { read(clipboardText(context)) },
                    Modifier.fillMaxWidth(),
                    variant = ButtonVariant.Outline,
                    size = ButtonSize.Lg,
                    leadingIcon = TablerIcons.Outline.Clipboard,
                )
            }
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
}

/** A square card with scanner corner marks; the camera, or what stands in for it, goes inside. */
@Composable
private fun Viewfinder(onClick: (() -> Unit)?, modifier: Modifier, content: @Composable () -> Unit) {
    val c = RelayTheme.colors
    val mark = c.foreground.copy(alpha = 0.55f)
    Box(
        modifier
            .aspectRatio(1f)
            .then(if (onClick != null) Modifier.pressable(onClick) else Modifier)
            .clip(Radii.xxlShape)
            .background(c.card)
            .ring(shape = Radii.xxlShape)
            .drawWithContent {
                drawContent()
                val inset = 20.dp.toPx()
                val arm = 26.dp.toPx()
                val stroke = Stroke(width = 2.5.dp.toPx(), cap = StrokeCap.Round)
                for (x in listOf(0, 1)) for (y in listOf(0, 1)) {
                    val cx = if (x == 0) inset else size.width - inset
                    val cy = if (y == 0) inset else size.height - inset
                    val dx = if (x == 0) arm else -arm
                    val dy = if (y == 0) arm else -arm
                    drawPath(
                        Path().apply {
                            moveTo(cx, cy + dy)
                            lineTo(cx, cy)
                            lineTo(cx + dx, cy)
                        },
                        mark,
                        style = stroke,
                    )
                }
            },
        contentAlignment = Alignment.Center,
    ) { content() }
}

@Composable
private fun Centered(content: @Composable ColumnScope.() -> Unit) = Column(
    Modifier.padding(32.dp),
    horizontalAlignment = Alignment.CenterHorizontally,
    verticalArrangement = Arrangement.spacedBy(8.dp),
    content = content,
)

@Composable
private fun Step(n: Int, text: String) {
    val c = RelayTheme.colors
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Box(Modifier.size(24.dp).clip(CircleShape).background(c.muted), contentAlignment = Alignment.Center) {
            Text("$n", style = RelayTheme.type.xs.copy(fontWeight = FontWeight.Medium), color = c.mutedForeground)
        }
        Text(text, style = RelayTheme.type.sm)
    }
}

private fun cameraAllowed(context: Context) =
    ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED

private fun clipboardText(context: Context): String {
    val clip = context.getSystemService(ClipboardManager::class.java)?.primaryClip ?: return ""
    if (clip.itemCount == 0) return ""
    return clip.getItemAt(0).coerceToText(context)?.toString() ?: ""
}
