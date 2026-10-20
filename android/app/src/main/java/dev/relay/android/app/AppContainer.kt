package dev.relay.android.app

import android.app.Application
import android.content.Context
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.ProcessLifecycleOwner
import dev.relay.android.features.applock.AppLock
import dev.relay.android.features.home.HomeServices
import dev.relay.android.features.home.StoreDrafts
import dev.relay.android.features.images.PendingImages
import dev.relay.android.features.dictation.Dictation
import dev.relay.android.features.notifications.ThreadNotifications
import dev.relay.android.features.readaloud.ReadAloud
import dev.relay.android.features.updates.Updates
import dev.relay.android.remote.OfflineCache
import dev.relay.android.remote.Remote
import dev.relay.android.remote.ThreadSeen
import dev.relay.android.remote.drafts.Sends
import dev.relay.android.remote.credentials.ComputerSeen
import dev.relay.android.remote.credentials.CredentialStore
import dev.relay.android.remote.tunnel.TunnelListeners
import dev.relay.android.remote.tunnel.TunnelPorts
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import java.io.File
import dev.relay.android.features.thread.ReadAhead
import dev.relay.android.features.thread.ThreadCache

/**
 * The app's object graph, built once in RelayApp. Wire services here and hand
 * them to screens from the entries in Entries.kt; nothing reaches for a global.
 */
class AppContainer(context: Context) {
    val app: Context = context.applicationContext
    val prefs = ShellPrefs(app)

    /** When the phone last reached each computer; the computers sheet reads it. */
    val computerSeen = ComputerSeen(File(app.filesDir, "computers-seen.json"))

    val remote = Remote(
        store = CredentialStore(File(app.filesDir, "computers")),
        cache = OfflineCache(File(app.cacheDir, "relay-offline")),
        seen = computerSeen,
        appVersion = app.packageManager.getPackageInfo(app.packageName, 0).versionName ?: "0.0.0",
    )

    /** Loopback listeners that carry the browser's connections to the computer's own ports. */
    val tunnels = TunnelListeners { remote.client.value?.tunnel }
    val tunnelPorts = TunnelPorts(object : TunnelPorts.Storage {
        // The old "typed" list was every computer's at once; whose port it was is lost, so it goes.
        private val prefs = app.getSharedPreferences("relay-tunnel", Context.MODE_PRIVATE)
            .also { if (it.contains("typed")) it.edit().remove("typed").apply() }
        override fun read(computer: String) = prefs.getString("typed:$computer", null)
        override fun write(computer: String, text: String) = prefs.edit().putString("typed:$computer", text).apply()
        override fun computers() = prefs.all.keys.filter { it.startsWith("typed:") }.map { it.removePrefix("typed:") }.toSet()
        override fun remove(computer: String) = prefs.edit().remove("typed:$computer").apply()
    })

    /** For work that outlives a screen: a switch or unpair that navigates away. */
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    val notifications = ThreadNotifications(app as Application, remote, scope).also { it.start() }
    val updates = Updates(app, remote, scope, busy = { notifications.busy }).also { it.start() }

    // One voice at a time: dictating stops a reading and the other way round.
    val dictation = Dictation.of(remote, app)
    val readAloud = ReadAloud.of(remote).also { r ->
        r.hold = { notifications.hold(ThreadNotifications.Reason.Read) }
        r.release = { notifications.release(ThreadNotifications.Reason.Read) }
        r.beforeStart = { dictation.stop() }
        dictation.beforeStart = { r.stop() }
    }

    val lock = AppLock(File(app.filesDir, "app-lock.bin"))

    /** Forgot PIN: every computer goes, as the lock did. */
    suspend fun forgetComputers() {
        remote.computers.value.forEach { remote.forget(it.id) }
    }

    val threadSeen = ThreadSeen(File(app.filesDir, "thread-seen.json"))
    val home = HomeServices(app, remote, threadSeen, StoreDrafts(Sends.drafts(app.filesDir), remote))

    init {
        // The drafts and outbox follow the connection from the start, not from the first composer.
        Sends.attach(remote, app.filesDir)
        PendingImages.lookup = { messageId, index -> Sends.outbox(app.filesDir).outgoingImage(messageId, index) }
    }

    init {
        // Once per process, not per activity: a rotation or fold mustn't reconnect.
        scope.launch { remote.load() }
        scope.launch { ReadAhead.of(remote, ThreadCache.of(app)).run() }
        ProcessLifecycleOwner.get().lifecycle.addObserver(object : DefaultLifecycleObserver {
            override fun onStart(owner: LifecycleOwner) {
                lock.back()
                remote.setBackground(false)
                remote.wake()
            }

            override fun onStop(owner: LifecycleOwner) {
                lock.left()
                remote.setBackground(true)
            }
        })
    }
}
