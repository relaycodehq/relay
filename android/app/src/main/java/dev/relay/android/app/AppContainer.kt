package dev.relay.android.app

import android.content.Context
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.ProcessLifecycleOwner
import dev.relay.android.features.home.HomeServices
import dev.relay.android.remote.OfflineCache
import dev.relay.android.remote.Remote
import dev.relay.android.remote.ThreadSeen
import dev.relay.android.remote.credentials.ComputerSeen
import dev.relay.android.remote.credentials.CredentialStore
import kotlinx.coroutines.MainScope
import kotlinx.coroutines.launch
import java.io.File

/**
 * The app's object graph, built once in RelayApp. Wire services here and hand
 * them to screens from the entries in Entries.kt; nothing reaches for a global.
 */
class AppContainer(context: Context) {
    val app: Context = context.applicationContext
    val prefs = ShellPrefs(app)
    private val scope = MainScope()

    /** When the phone last reached each computer; the computers sheet reads it. */
    val computerSeen = ComputerSeen(File(app.filesDir, "computers-seen.json"))

    val remote = Remote(
        store = CredentialStore(File(app.filesDir, "computers")),
        cache = OfflineCache(File(app.cacheDir, "relay-offline")),
        seen = computerSeen,
        appVersion = app.packageManager.getPackageInfo(app.packageName, 0).versionName ?: "0.0.0",
    )

    val threadSeen = ThreadSeen(File(app.filesDir, "thread-seen.json"))
    val home = HomeServices(app, remote, threadSeen)

    init {
        // Once per process, not per activity: a rotation or fold mustn't reconnect.
        scope.launch { remote.load() }
        ProcessLifecycleOwner.get().lifecycle.addObserver(object : DefaultLifecycleObserver {
            override fun onStart(owner: LifecycleOwner) = remote.wake()
        })
    }
}
