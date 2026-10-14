package dev.relay.android.features.notifications

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
import dev.relay.android.R

private const val ONGOING_ID = 7301
private const val CONNECTION_CHANNEL = "relay-connection"
private const val THREADS_CHANNEL = "relay-threads"
private const val ACCENT = 0xFF8B7FC0.toInt()

/**
 * Keeps the app's process in the foreground while the phone follows a
 * computer or reads an answer aloud, so Android leaves its socket and its
 * audio alone with the screen off. It holds no wake lock: the computer's tick
 * every 15 seconds and the audio itself wake the phone.
 */
class WatchService : Service() {
    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val notification = ongoing(this, intent?.getStringExtra("title") ?: "Relay", intent?.getStringExtra("text") ?: "")
        try {
            if (Build.VERSION.SDK_INT >= 34) startForeground(
                ONGOING_ID, notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_REMOTE_MESSAGING or ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK,
            ) else startForeground(ONGOING_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK)
        } catch (e: Exception) {
            // Started from the background, which Android 12 and later refuse.
            Log.w(TAG, "Couldn't stay in the foreground", e)
            stopSelf()
        }
        return START_NOT_STICKY
    }

    companion object {
        private const val TAG = "WatchService"

        /** Throws when Android refuses a start from the background. */
        fun start(context: Context, title: String, text: String) {
            context.startForegroundService(
                Intent(context, WatchService::class.java).putExtra("title", title).putExtra("text", text),
            )
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, WatchService::class.java))
        }

        /** Rewords the notice while the service runs. */
        fun update(context: Context, title: String, text: String) {
            manager(context).notify(ONGOING_ID, ongoing(context, title, text))
        }

        /** One per thread, `tag` being its id: a newer one replaces it. */
        fun post(context: Context, tag: String, title: String, body: String, url: String) {
            channels(context)
            val open = Intent(Intent.ACTION_VIEW, Uri.parse(url))
                .setPackage(context.packageName)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            val tap = PendingIntent.getActivity(
                context, tag.hashCode(), open,
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
            )
            val notification = Notification.Builder(context, THREADS_CHANNEL)
                .setSmallIcon(R.drawable.relay_notification)
                .setColor(ACCENT)
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(Notification.BigTextStyle().bigText(body))
                .setContentIntent(tap)
                .setAutoCancel(true)
                .setCategory(Notification.CATEGORY_MESSAGE)
                .setWhen(System.currentTimeMillis())
                .setShowWhen(true)
                .build()
            try {
                manager(context).notify(tag, 0, notification)
            } catch (e: SecurityException) {
                Log.w(TAG, "Not allowed to notify", e)
            }
        }

        fun clear(context: Context, tag: String) = manager(context).cancel(tag, 0)

        fun enabled(context: Context) = manager(context).areNotificationsEnabled()

        private fun ongoing(context: Context, title: String, text: String): Notification {
            channels(context)
            val tap = context.packageManager.getLaunchIntentForPackage(context.packageName)?.let {
                PendingIntent.getActivity(context, 0, it, PendingIntent.FLAG_IMMUTABLE)
            }
            return Notification.Builder(context, CONNECTION_CHANNEL)
                .setSmallIcon(R.drawable.relay_notification)
                .setColor(ACCENT)
                .setContentTitle(title)
                .setContentText(text)
                .setContentIntent(tap)
                .setOngoing(true)
                // Its own group, or Android bundles it with the threads' news and it shows as loudly.
                .setGroup(CONNECTION_CHANNEL)
                .setShowWhen(false)
                .setCategory(Notification.CATEGORY_SERVICE)
                .build()
        }

        private fun channels(context: Context) {
            val manager = manager(context)
            if (manager.getNotificationChannel(THREADS_CHANNEL) == null)
                manager.createNotificationChannel(
                    NotificationChannel(THREADS_CHANNEL, "Threads", NotificationManager.IMPORTANCE_HIGH).apply {
                        description = "When an agent finishes, fails or needs you."
                    },
                )
            if (manager.getNotificationChannel(CONNECTION_CHANNEL) == null)
                manager.createNotificationChannel(
                    NotificationChannel(CONNECTION_CHANNEL, "Staying connected", NotificationManager.IMPORTANCE_MIN).apply {
                        description = "Shown while Relay follows your computer in the background."
                        setShowBadge(false)
                    },
                )
        }

        private fun manager(context: Context) =
            context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    }
}
