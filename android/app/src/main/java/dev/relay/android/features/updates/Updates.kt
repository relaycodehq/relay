package dev.relay.android.features.updates

import android.content.Context
import android.content.pm.ApplicationInfo
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.ProcessLifecycleOwner
import dev.relay.android.remote.Remote
import dev.relay.android.remote.client.LinkState
import dev.relay.android.remote.client.reportApp
import dev.relay.android.remote.model.PhoneAppReport
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import java.util.concurrent.TimeUnit

/**
 * The app's own updates and its computer's, wired once in AppContainer.
 *
 * Only the APK path: the Expo app also took JavaScript from its desktop over
 * the air, but this app has no bundle to swap, so a new version is always a
 * new APK from the signed release feed. It reports itself to the desktop as
 * not taking the desktop's updates.
 */
class Updates(
    context: Context,
    private val remote: Remote,
    private val scope: CoroutineScope,
    /** The app is holding the foreground for a running thread or read-aloud; an update would cut it off. */
    private val busy: () -> Boolean = { false },
) {
    private val app = context.applicationContext
    val installed: String = app.packageManager.getPackageInfo(app.packageName, 0).versionName ?: "0.0.0"
    val packageName: String = app.packageName

    /** Debuggable builds are signed with another key; Android would refuse the release APK. */
    val releaseBuild = app.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE == 0

    private val http = OkHttpClient.Builder().callTimeout(20, TimeUnit.SECONDS).build()
    private val native = AndroidApk(app, http)

    val installer = ApkInstaller(native, scope, pending = { installed })

    val latest = LatestApp(
        fetch = { fetchNewestApp(::get, packageName) },
        storage = object : LatestAppStorage {
            private val prefs = app.getSharedPreferences("relay-updates", Context.MODE_PRIVATE)
            override fun read() = prefs.getString(KEY, null)
            override fun write(text: String) {
                prefs.edit().putString(KEY, text).apply()
            }
        },
        installed = installed,
        packageName = packageName,
        releaseBuild = releaseBuild,
        metered = native::metered,
        prefetch = { installer.prefetch(it.apkOffer()) },
    )

    val computers = ComputerUpdates(remote, scope)

    private suspend fun get(url: String): FeedResponse = withContext(Dispatchers.IO) {
        http.newCall(Request.Builder().url(url).build()).execute().use {
            FeedResponse(it.isSuccessful, it.code, it.body.bytes())
        }
    }

    /** What this app runs, for the desktop's Settings. */
    val report = PhoneAppReport(version = installed, updated = false, apk = installed, updates = false)

    fun start() {
        native.dropInstalled(installed)
        computers.start()
        scope.launch { latest.check() }
        // Looks again whenever the app comes back to the front, at most every few hours.
        ProcessLifecycleOwner.get().lifecycle.addObserver(object : DefaultLifecycleObserver {
            override fun onStart(owner: LifecycleOwner) {
                scope.launch { latest.check() }
            }

            // Leaving the app is when a downloaded update goes in, silently, unless something is running.
            override fun onStop(owner: LifecycleOwner) {
                if (!releaseBuild || busy()) return
                val offer = latest.installableOffer() ?: return
                scope.launch { installer.installQuietly(offer.apkOffer()) }
            }
        })
        scope.launch {
            combine(remote.status, remote.client) { s, c -> if (s.state == LinkState.Online) c else null }
                .distinctUntilChanged()
                .collect { client ->
                    // Older desktops don't take the report.
                    if (client != null) runCatching { client.reportApp(report) }
                }
        }
    }

    fun install(offer: NewestApp) = scope.launch {
        installer.install(offer.apkOffer(), browser = !releaseBuild)
    }

    /** Updates go in by themselves when the app is left: Relay installed its last update itself. */
    val installsSilently get() = releaseBuild && native.installsSilently()

    fun checkNow() = scope.launch { latest.check(force = true) }

    fun openReleasePage() = native.openUrl(Releases.PAGE)

    private companion object { const val KEY = "relay.latestApp" }
}
