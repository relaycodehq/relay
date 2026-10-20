package dev.relay.android.features.notifications

import android.Manifest
import android.content.Context
import android.content.Intent
import android.os.Build
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import dev.relay.android.ui.ConfirmDialog
import dev.relay.android.ui.ListRow
import dev.relay.android.ui.Switch

/** Settings' "Background notifications" row: asks Android first, or points at its settings. */
@Composable
fun NotificationSwitchRow(notifications: ThreadNotifications, computer: String) {
    val context = LocalContext.current
    val on by notifications.on.collectAsState()
    var refused by remember { mutableStateOf(false) }
    val ask = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (!granted || !notifications.setOn(true)) refused = true
    }
    fun change(want: Boolean) {
        when {
            !want || notifications.permitted() -> notifications.setOn(want)
            Build.VERSION.SDK_INT >= 33 -> ask.launch(Manifest.permission.POST_NOTIFICATIONS)
            else -> refused = true
        }
    }
    ListRow(
        "Background notifications",
        subtitle = "When a thread finishes or needs you while Relay is closed. A worker keeps Relay connected " +
            "to $computer for that, with a quiet notice in the shade, and uses some battery. To spare it, " +
            "they can come up to 30s late.",
        subtitleLines = 5,
        trailing = { Switch(on, ::change) },
        onClick = { change(!on) },
    )
    if (refused) ConfirmDialog(
        "Notifications are off for Relay",
        onConfirm = {
            refused = false
            openNotificationSettings(context)
        },
        onDismiss = { refused = false },
        message = "Turn them on in Android's settings.",
        confirmText = "Open settings",
        cancelText = "Not now",
    )
}

private fun openNotificationSettings(context: Context) {
    context.startActivity(
        Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
            .putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
    )
}
