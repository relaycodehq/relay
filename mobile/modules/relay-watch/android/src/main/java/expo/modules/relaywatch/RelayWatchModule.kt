package expo.modules.relaywatch

import android.Manifest
import android.os.Build
import com.facebook.react.ReactApplication
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactContext
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.jstasks.HeadlessJsTaskConfig
import com.facebook.react.jstasks.HeadlessJsTaskContext
import expo.modules.interfaces.permissions.Permissions
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Follows the computer with the app in the background: a foreground service
 * so Android keeps the process and its socket, a headless JS task so React
 * Native keeps the app's timers going while no screen shows, and the
 * notifications the app posts when a thread finishes or needs you.
 */
class RelayWatchModule : Module() {
  private var task: Int? = null

  private val context
    get() = appContext.reactContext ?: throw WatchException("Relay isn't running.")

  override fun definition() = ModuleDefinition {
    Name("RelayWatch")

    AsyncFunction("requestPermission") { promise: Promise ->
      // Before Android 13 notifications need no asking; they can still be off.
      if (Build.VERSION.SDK_INT < 33)
        promise.resolve(mapOf("granted" to RelayWatchService.enabled(context)))
      else
        Permissions.askForPermissionsWithPermissionsManager(
          appContext.permissions,
          promise,
          Manifest.permission.POST_NOTIFICATIONS,
        )
    }
    Function("enabled") { RelayWatchService.enabled(context) }

    /** Must be called with the app on screen: Android refuses it from the background. */
    Function("start") { title: String, text: String ->
      RelayWatchService.start(context, title, text)
      startTask()
    }
    Function("update") { title: String, text: String ->
      if (task != null) RelayWatchService.update(context, title, text)
    }
    Function("stop") { stop() }

    Function("notify") { tag: String, title: String, body: String, url: String ->
      RelayWatchService.post(context, tag, title, body, url)
    }
    Function("clear") { tag: String -> RelayWatchService.clear(context, tag) }

    OnDestroy { stop() }
  }

  /** The context React Native's timers listen on for headless tasks. */
  private val react: ReactContext?
    get() {
      val app = appContext.reactContext?.applicationContext as? ReactApplication
      return app?.reactHost?.currentReactContext ?: appContext.reactContext as? ReactContext
    }

  private fun startTask() {
    val react = react ?: return
    UiThreadUtil.runOnUiThread {
      if (task != null) return@runOnUiThread
      // Allowed in the foreground: it starts there and outlives it.
      task = HeadlessJsTaskContext.getInstance(react)
        .startTask(HeadlessJsTaskConfig("RelayWatch", Arguments.createMap(), 0, true))
    }
  }

  private fun stop() {
    val react = react
    UiThreadUtil.runOnUiThread {
      task?.let { id -> react?.let { HeadlessJsTaskContext.getInstance(it).finishTask(id) } }
      task = null
    }
    appContext.reactContext?.let { RelayWatchService.stop(it) }
  }
}

private class WatchException(message: String) : CodedException("ERR_RELAY_WATCH", message, null)
