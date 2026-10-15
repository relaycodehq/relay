package dev.relay.android.app

import android.app.Activity
import android.app.Application
import android.content.Intent
import android.os.Bundle
import android.os.Process
import androidx.compose.runtime.Immutable
import dev.relay.android.MainActivity
import kotlin.system.exitProcess

/** What took the last process down: a line for the page, the whole trace to copy. */
@Immutable
data class Crash(val summary: String, val details: String)

/**
 * Compose has no error boundary, so a screen that throws takes the whole app
 * with it. Instead of Android's "Relay keeps stopping", a crash while Relay is
 * on screen opens it again, fresh, on [CrashScreen], with a way back to Home.
 */
object CrashRecovery {
    private const val SUMMARY = "dev.relay.android.crash.summary"
    private const val DETAILS = "dev.relay.android.crash.details"

    /** The trace rides in the relaunch's intent, which Binder caps at about 1 MB. */
    private const val MAX_DETAILS = 32_000

    @Volatile private var started = 0

    /**
     * Set while the crash page is up. A crash then (the page, or the fresh
     * process breaking again before anyone looked) goes to Android, or Relay
     * would reopen itself forever.
     */
    @Volatile private var showing = false

    fun install(app: Application) {
        app.registerActivityLifecycleCallbacks(object : Application.ActivityLifecycleCallbacks {
            override fun onActivityStarted(activity: Activity) { started++ }
            override fun onActivityStopped(activity: Activity) { started-- }
            override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) {}
            override fun onActivityResumed(activity: Activity) {}
            override fun onActivityPaused(activity: Activity) {}
            override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) {}
            override fun onActivityDestroyed(activity: Activity) {}
        })
        val android = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, error ->
            // Off screen there's no page to show, and Android wouldn't let one open.
            if (started == 0 || showing || !relaunch(app, error)) android?.uncaughtException(thread, error)
            else {
                Process.killProcess(Process.myPid())
                exitProcess(10)
            }
        }
    }

    private fun relaunch(app: Application, error: Throwable): Boolean = runCatching {
        // The innermost cause usually names the actual problem; the wrappers name where it surfaced.
        val cause = generateSequence(error) { it.cause }.take(20).last()
        app.startActivity(
            Intent(app, MainActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
                .putExtra(SUMMARY, listOfNotNull(cause::class.java.simpleName.ifEmpty { cause::class.java.name }, cause.message).joinToString(": ").take(300))
                .putExtra(DETAILS, error.stackTraceToString().take(MAX_DETAILS)),
        )
    }.isSuccess

    /** The crash this launch came back from, if it did. */
    fun take(intent: Intent?): Crash? {
        val summary = intent?.getStringExtra(SUMMARY) ?: return null
        showing = true
        return Crash(summary, intent.getStringExtra(DETAILS).orEmpty())
    }

    fun seen() {
        showing = false
    }
}
