package dev.relay.android.app

import android.app.Application
import android.content.Context
import dev.relay.android.features.dictation.Dictation
import dev.relay.android.features.notifications.ThreadNotifications
import dev.relay.android.features.readaloud.ReadAloud
import dev.relay.android.features.updates.Updates
import dev.relay.android.remote.OfflineCache
import dev.relay.android.remote.Remote
import dev.relay.android.remote.credentials.ComputerSeen
import dev.relay.android.remote.credentials.CredentialStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import java.io.File

/**
 * The app's object graph, built once in RelayApp. Wire services here and hand
 * them to screens from the entries in Entries.kt; nothing reaches for a global.
 */
class AppContainer(context: Context) {
    val app: Context = context.applicationContext
    val prefs = ShellPrefs(app)

    val remote = Remote(
        store = CredentialStore(File(app.filesDir, "computers")),
        cache = OfflineCache(File(app.cacheDir, "relay-offline")),
        seen = ComputerSeen(File(app.filesDir, "computers-seen.json")),
        appVersion = app.packageManager.getPackageInfo(app.packageName, 0).versionName ?: "0.0.0",
    )

    /** For work that outlives a screen: a switch or unpair that navigates away. */
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    val updates = Updates(app, remote, scope).also { it.start() }
    val notifications = ThreadNotifications(app as Application, remote, scope).also { it.start() }

    // One voice at a time: dictating stops a reading and the other way round.
    val dictation = Dictation.of(remote, app)
    val readAloud = ReadAloud.of(remote).also { r ->
        r.hold = { notifications.hold(ThreadNotifications.Reason.Read) }
        r.release = { notifications.release(ThreadNotifications.Reason.Read) }
        r.beforeStart = { dictation.stop() }
        dictation.beforeStart = { r.stop() }
    }
}
