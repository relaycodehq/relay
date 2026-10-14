package dev.relay.android.app

import android.content.Context
import dev.relay.android.remote.OfflineCache
import dev.relay.android.remote.Remote
import dev.relay.android.remote.credentials.ComputerSeen
import dev.relay.android.remote.credentials.CredentialStore
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
}
