package expo.modules.relaywatch

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.Uri
import android.os.Build
import android.os.IBinder
import android.util.Log

private const val ongoingId = 7301
private const val connectionChannel = "relay-connection"
private const val threadsChannel = "relay-threads"
private const val accent = 0xFF8B7FC0.toInt()

/**
 * Keeps the app's process in the foreground while the phone follows a
 * computer or reads an answer aloud, so Android leaves its socket and its
 * audio alone with the screen off. It holds no wake lock: the computer's
 * tick every 15 seconds and the audio itself wake the phone.
 */
class RelayWatchService : Service() {
  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val notification = ongoing(
      this,
      intent?.getStringExtra("title") ?: "Relay",
      intent?.getStringExtra("text") ?: "",
    )
    try {
      when {
        Build.VERSION.SDK_INT >= 34 -> startForeground(
          ongoingId,
          notification,
          ServiceInfo.FOREGROUND_SERVICE_TYPE_REMOTE_MESSAGING or
            ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK,
        )
        Build.VERSION.SDK_INT >= 29 -> startForeground(
          ongoingId,
          notification,
          ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK,
        )
        else -> startForeground(ongoingId, notification)
      }
    } catch (e: Exception) {
      // Started from the background, which Android 12 and later refuse.
      Log.w("RelayWatch", "Couldn't stay in the foreground", e)
      stopSelf()
    }
    // Without the app's JS there is nothing to keep alive.
    return START_NOT_STICKY
  }

  companion object {
    fun start(context: Context, title: String, text: String) {
      val intent = Intent(context, RelayWatchService::class.java)
        .putExtra("title", title)
        .putExtra("text", text)
      if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(intent)
      else context.startService(intent)
    }

    fun stop(context: Context) {
      context.stopService(Intent(context, RelayWatchService::class.java))
    }

    /** Rewords the notice while the service runs. */
    fun update(context: Context, title: String, text: String) {
      manager(context).notify(ongoingId, ongoing(context, title, text))
    }

    /** One per thread, `tag` being its id: a newer one replaces it. */
    fun post(context: Context, tag: String, title: String, body: String, url: String) {
      channels(context)
      val open = Intent(Intent.ACTION_VIEW, Uri.parse(url))
        .setPackage(context.packageName)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      val tap = PendingIntent.getActivity(
        context,
        tag.hashCode(),
        open,
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
      )
      val notification = builder(context, threadsChannel)
        .setSmallIcon(R.drawable.relay_notification)
        .setColor(accent)
        .setContentTitle(title)
        .setContentText(body)
        .setStyle(Notification.BigTextStyle().bigText(body))
        .setContentIntent(tap)
        .setAutoCancel(true)
        .setCategory(Notification.CATEGORY_MESSAGE)
        .setWhen(System.currentTimeMillis())
        .setShowWhen(true)
        .build()
      manager(context).notify(tag, 0, notification)
    }

    fun clear(context: Context, tag: String) = manager(context).cancel(tag, 0)

    fun enabled(context: Context) = manager(context).areNotificationsEnabled()

    private fun ongoing(context: Context, title: String, text: String): Notification {
      channels(context)
      val launch = context.packageManager.getLaunchIntentForPackage(context.packageName)
      val tap = launch?.let {
        PendingIntent.getActivity(context, 0, it, PendingIntent.FLAG_IMMUTABLE)
      }
      return builder(context, connectionChannel)
        .setSmallIcon(R.drawable.relay_notification)
        .setColor(accent)
        .setContentTitle(title)
        .setContentText(text)
        .setContentIntent(tap)
        .setOngoing(true)
        // Its own group, or Android bundles it with the threads' news and it
        // shows as loudly as they do.
        .setGroup(connectionChannel)
        .setShowWhen(false)
        .setCategory(Notification.CATEGORY_SERVICE)
        .build()
    }

    @Suppress("DEPRECATION")
    private fun builder(context: Context, channel: String) =
      if (Build.VERSION.SDK_INT >= 26) Notification.Builder(context, channel)
      else Notification.Builder(context)

    private fun channels(context: Context) {
      if (Build.VERSION.SDK_INT < 26) return
      val manager = manager(context)
      if (manager.getNotificationChannel(threadsChannel) == null)
        manager.createNotificationChannel(
          NotificationChannel(threadsChannel, "Threads", NotificationManager.IMPORTANCE_HIGH).apply {
            description = "When an agent finishes, fails or needs you."
          },
        )
      if (manager.getNotificationChannel(connectionChannel) == null)
        manager.createNotificationChannel(
          NotificationChannel(connectionChannel, "Staying connected", NotificationManager.IMPORTANCE_MIN).apply {
            description = "Shown while Relay follows your computer in the background."
            setShowBadge(false)
          },
        )
    }

    private fun manager(context: Context) =
      context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
  }
}
