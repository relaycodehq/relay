package dev.relay.android.features.notifications

import android.Manifest
import android.app.Activity
import android.app.Application
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.util.Log
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.ProcessLifecycleOwner
import dev.relay.android.remote.Remote
import dev.relay.android.remote.client.LinkState
import dev.relay.android.remote.model.RemoteEvent
import dev.relay.android.remote.model.RemoteChatSummary
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import java.lang.ref.WeakReference

/**
 * mobile/src/remote/watch.ts: follows the computer with the app in your
 * pocket. The foreground service keeps the connection (and read aloud) going
 * with the screen off, and a thread that finishes, fails or needs you posts a
 * notification. Built once in the container; everything runs on the main thread.
 */
class ThreadNotifications(private val app: Application, private val remote: Remote, private val scope: CoroutineScope) {
    enum class Reason { Watch, Read }
    private data class Notice(val title: String, val text: String)

    private val notices = mutableMapOf(
        Reason.Watch to Notice("Relay", ""),
        Reason.Read to Notice("Reading aloud", "Relay keeps reading with the screen off."),
    )
    private val holding = mutableSetOf<Reason>()
    private var running = false

    private val prefs = app.getSharedPreferences("relay-notifications", Context.MODE_PRIVATE)
    private val _on = MutableStateFlow(prefs.getString(PREF_KEY, null) != "off")

    /** Whether threads notify while the app is away; on unless turned off. */
    val on: StateFlow<Boolean> = _on.asStateFlow()

    private val enabled = MutableStateFlow(false)
    private var before = emptyMap<String, RemoteChatSummary>()
    private val answers = mutableMapOf<String, Pair<LastAnswer, Long>>()
    private val held = HeldNews()
    private var resumed: WeakReference<Activity>? = null

    private val foreground get() = ProcessLifecycleOwner.get().lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)

    /**
     * Work an install would cut short: a thread running on the computer or a
     * reply read aloud. The idle watch on the connection doesn't count.
     */
    val busy get() = Reason.Read in holding || remote.overview.value?.chats?.any { it.running == true } == true

    private fun notice() = notices.getValue(if (Reason.Read in holding) Reason.Read else Reason.Watch)

    /** Keeps the app in the foreground for `reason` until released. */
    fun hold(reason: Reason, title: String? = null, text: String? = null) {
        if (title != null) notices[reason] = Notice(title, text ?: "")
        holding += reason
        val shown = notice()
        if (running) return WatchService.update(app, shown.title, shown.text)
        // Android only lets an app on screen start it; onStart tries again.
        if (!foreground) return
        try {
            WatchService.start(app, shown.title, shown.text)
            running = true
        } catch (e: Exception) {
            Log.w(TAG, "Couldn't start the watch", e)
        }
    }

    fun release(reason: Reason) {
        if (!holding.remove(reason) || !running) return
        if (holding.isNotEmpty()) {
            val shown = notice()
            return WatchService.update(app, shown.title, shown.text)
        }
        running = false
        WatchService.stop(app)
    }

    /** Puts away a thread's notification, once it's open on the phone. */
    fun clearThread(chatId: String) = WatchService.clear(app, chatId)

    fun permitted() = WatchService.enabled(app)

    /**
     * Saves the switch. Turning it on needs Android's permission: Settings asks
     * for it first (see rememberNotificationSwitch), so this only refuses.
     */
    fun setOn(on: Boolean): Boolean {
        if (on && !permitted()) return false
        _on.value = on
        prefs.edit().putString(PREF_KEY, if (on) "on" else "off").apply()
        return true
    }

    /** Android 13 asks once; after two refusals it stops showing the prompt by itself. */
    private fun askOnce() {
        if (Build.VERSION.SDK_INT < 33 || permitted() || prefs.getBoolean(ASKED_KEY, false)) return
        val activity = resumed?.get() ?: return
        if (ContextCompat.checkSelfPermission(activity, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) return
        prefs.edit().putBoolean(ASKED_KEY, true).apply()
        ActivityCompat.requestPermissions(activity, arrayOf(Manifest.permission.POST_NOTIFICATIONS), 7302)
    }

    fun start() {
        app.registerActivityLifecycleCallbacks(object : Application.ActivityLifecycleCallbacks {
            override fun onActivityResumed(activity: Activity) {
                resumed = WeakReference(activity)
                if (enabled.value) askOnce()
            }
            override fun onActivityPaused(activity: Activity) {
                if (resumed?.get() === activity) resumed = null
            }
            override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) {}
            override fun onActivityStarted(activity: Activity) {}
            override fun onActivityStopped(activity: Activity) {}
            override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) {}
            override fun onActivityDestroyed(activity: Activity) {}
        })
        ProcessLifecycleOwner.get().lifecycle.addObserver(object : DefaultLifecycleObserver {
            override fun onStart(owner: LifecycleOwner) {
                if (holding.isNotEmpty() && !running) holding.first().let { hold(it) }
            }
        })

        scope.launch {
            combine(remote.client, _on) { client, on -> client != null && on }.collect { enabled.value = it }
        }
        scope.launch { enabled.collect { if (it) askOnce() } }

        // Starts once connected with the app on screen; kept through reconnects
        // so a dropped link can come back in the background.
        scope.launch {
            combine(enabled, remote.status, remote.computers, remote.active, remote.overview) { on, status, computers, active, overview ->
                Triple(on, status.state, computers.find { it.id == active }?.name ?: overview?.name ?: "your computer")
            }.distinctUntilChanged().collect { (on, state, name) ->
                if (!on) return@collect release(Reason.Watch)
                val text = when (state) {
                    LinkState.Online -> "Tells you when a thread finishes or needs you."
                    LinkState.Offline -> "Reconnecting…"
                    else -> ""
                }
                if (state == LinkState.Online || running) hold(Reason.Watch, "Connected to $name", text)
            }
        }

        // Another computer's threads aren't news about this one's.
        scope.launch {
            remote.active.collect {
                before = emptyMap()
                answers.clear()
                held.clear()
            }
        }

        scope.launch {
            remote.events.collect { e ->
                if (e !is RemoteEvent.Message) return@collect
                val m = e.message
                if (m.role != "assistant" || m.parentId != null || m.compaction == true || m.handoff != null || m.reload != null) return@collect
                val last = answers[e.chatId]
                if (last != null && last.second > m.created) return@collect
                answers[e.chatId] = LastAnswer(m.status, m.body, m.error, m.provider) to m.created
            }
        }

        scope.launch {
            // The list and whether someone sits at the computer come as one, so
            // news is judged by the presence its own list came with.
            remote.overview.map { it?.chats to (it?.present == true) }.distinctUntilChanged().collect { (chats, present) ->
                if (chats == null) return@collect
                val was = before
                before = chats.associateBy { it.id }
                if (!enabled.value) return@collect held.clear()
                if (was.isEmpty()) return@collect
                for (id in threadsRead(was, chats)) WatchService.clear(app, id)
                // On screen the app shows it already.
                val news = if (foreground) emptyList() else threadNews(was, chats, answers.mapValues { it.value.first })
                // Someone at the computer sees it there, unless they leave before reading it.
                val due = held.next(before, present, news)
                if (!foreground) due.forEach(::post)
            }
        }

        // A computer that quits, crashes or loses the network can't say it was left.
        // Only while the phone's own network works, or a dead spot would look like it.
        scope.launch {
            combine(remote.status.map { it.state == LinkState.Online }, phoneNetwork(app)) { online, network ->
                online to network
            }.distinctUntilChanged().collectLatest { (online, network) ->
                if (online || network == null) return@collectLatest
                delay(GONE_MS)
                val due = held.next(before, present = false, news = emptyList())
                if (enabled.value && !foreground) due.forEach(::post)
            }
        }
    }

    private fun post(news: ThreadNews) =
        WatchService.post(app, news.chatId, news.title, news.body, "relay-native://chat/${news.chatId}")

    private companion object {
        const val TAG = "ThreadNotifications"
        /** Long enough for Relay to restart or the link to come back. */
        const val GONE_MS = 2 * 60_000L
        const val PREF_KEY = "relay-notifications"
        const val ASKED_KEY = "relay-notifications-asked"
    }
}
