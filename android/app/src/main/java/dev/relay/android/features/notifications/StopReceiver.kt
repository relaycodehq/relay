package dev.relay.android.features.notifications

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** What the app does when its notification's Stop is tapped; the Application implements it. */
interface StopsRelay {
    fun stopRelay()
}

/** The ongoing notification's Stop button. */
class StopReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        (context.applicationContext as? StopsRelay)?.stopRelay()
    }
}
