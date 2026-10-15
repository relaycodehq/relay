package dev.relay.android.app

import android.content.ClipData
import android.content.ClipboardManager
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import dev.relay.android.ui.Button
import dev.relay.android.ui.ButtonSize
import dev.relay.android.ui.ButtonVariant
import dev.relay.android.ui.EmptyState
import dev.relay.android.ui.theme.RelayTheme
import io.github.lyxnx.compose.ui.tablericons.TablerIcons
import io.github.lyxnx.compose.ui.tablericons.outline.Bug

/**
 * Where Relay comes back after a crash (CrashRecovery): what broke, and the
 * way on. The process is new and its stack starts at Home, so going home is
 * only this page going away.
 */
@Composable
fun CrashScreen(crash: Crash, onHome: () -> Unit) {
    val context = LocalContext.current
    var copied by remember { mutableStateOf(false) }
    BackHandler(onBack = onHome)
    Box(
        Modifier.fillMaxSize().background(RelayTheme.colors.background).windowInsetsPadding(WindowInsets.safeDrawing),
        contentAlignment = Alignment.Center,
    ) {
        EmptyState(
            "Relay hit a bug",
            description = crash.summary,
            icon = TablerIcons.Outline.Bug,
            action = {
                Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button("Back to Home", onHome)
                    Button(
                        if (copied) "Copied" else "Copy details",
                        onClick = {
                            context.getSystemService(ClipboardManager::class.java)
                                ?.setPrimaryClip(ClipData.newPlainText("Relay crash", crash.details))
                            copied = true
                        },
                        variant = ButtonVariant.Ghost,
                        size = ButtonSize.Sm,
                    )
                }
            },
        )
    }
}
