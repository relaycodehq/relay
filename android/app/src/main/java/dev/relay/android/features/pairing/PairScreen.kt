package dev.relay.android.features.pairing

import android.Manifest
import android.content.ClipboardManager
import android.content.Context
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.border
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
import dev.relay.android.ui.Divider
import dev.relay.android.ui.Screen
import dev.relay.android.ui.Spinner
import dev.relay.android.ui.Text
import dev.relay.android.ui.theme.Radii
import dev.relay.android.ui.theme.RelayTheme
import io.github.lyxnx.compose.ui.tablericons.TablerIcons
import io.github.lyxnx.compose.ui.tablericons.outline.Camera
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
    Screen("Pair", onBack = nav.backAction) {
        Column(
            Modifier.verticalScroll(rememberScrollState()).padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Text(
                when {
                    linked != null -> "Pair this phone with ${linked.name}?"
                    computers.isNotEmpty() -> "Pair another computer"
                    else -> "Pair with your computer"
                },
                style = RelayTheme.type.base.copy(fontSize = 20.sp, fontWeight = FontWeight.SemiBold),
            )
            Text(
                if (linked != null) "On the same Wi-Fi as your computer, this phone connects to it directly."
                else "On your computer, open Relay → Settings → Phone and choose Show pairing code, then scan it here. On the same Wi-Fi the phone connects to it directly.",
                style = hint,
                color = c.mutedForeground,
            )
            val pending = busy
            when {
                pending != null -> Column(
                    Modifier.fillMaxWidth().padding(vertical = 30.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    Spinner(size = 20.dp, color = c.mutedForeground)
                    Text(pending, style = hint, color = c.mutedForeground)
                }
                linked != null -> Button("Pair", { pair(linked) })
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
                    modifier = Modifier.fillMaxWidth().aspectRatio(1f)
                        .clip(Radii.xlShape).border(1.dp, c.border, Radii.xlShape),
                )
                else -> Button("Use the camera", { ask.launch(Manifest.permission.CAMERA) }, leadingIcon = TablerIcons.Outline.Camera)
            }
            if (cameraRefused && !camera && busy == null && linked == null) Text(
                "Relay can't use the camera. Allow it in Android's settings for Relay, or paste the link instead.",
                style = hint,
                color = c.mutedForeground,
            )
            if (busy == null && linked == null) Button(
                "Paste pairing link",
                { read(clipboardText(context)) },
                variant = ButtonVariant.Outline,
                leadingIcon = TablerIcons.Outline.Clipboard,
            )
            error?.let { message ->
                Text(
                    message + if (message.startsWith("That isn't")) ""
                    else " Check that this phone is on the same Wi-Fi, or that Tailscale is on and signed in here.",
                    style = hint,
                    color = c.destructive,
                )
            }
            Divider()
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("Away from home too", style = RelayTheme.type.base.copy(fontWeight = FontWeight.SemiBold))
                Text(
                    "Optional: with Tailscale on this phone and your computer, signed in to the same account, Relay reaches it from anywhere.",
                    style = hint,
                    color = c.mutedForeground,
                )
                Button(
                    "Get Tailscale",
                    { uri.openUri(TAILSCALE_PLAY) },
                    variant = ButtonVariant.Outline,
                    trailingIcon = TablerIcons.Outline.ExternalLink,
                )
            }
        }
    }
}

private fun cameraAllowed(context: Context) =
    ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED

private fun clipboardText(context: Context): String {
    val clip = context.getSystemService(ClipboardManager::class.java)?.primaryClip ?: return ""
    if (clip.itemCount == 0) return ""
    return clip.getItemAt(0).coerceToText(context)?.toString() ?: ""
}
