package dev.relay.android

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import dev.relay.android.app.RelayRoot
import dev.relay.android.lib.navigation.Route
import dev.relay.android.lib.navigation.routeForDeepLink
import kotlinx.coroutines.channels.Channel
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import dev.relay.android.app.Crash
import dev.relay.android.app.CrashRecovery

class MainActivity : ComponentActivity() {
    private val links = Channel<Route>(Channel.BUFFERED)

    /** The crash this launch came back from, until the reader goes on to Home. */
    private var crash by mutableStateOf<Crash?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        // A restored activity already has the link's screen on its saved stack.
        if (savedInstanceState == null) {
            crash = CrashRecovery.take(intent)
            deliver(intent)
        }
        val container = (application as RelayApp).container
        setContent {
            RelayRoot(container, links, crash) {
                crash = null
                CrashRecovery.seen()
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        deliver(intent)
    }

    private fun deliver(intent: Intent?) {
        val url = intent?.takeIf { it.action == Intent.ACTION_VIEW }?.dataString ?: return
        routeForDeepLink(url)?.let { links.trySend(it) }
    }
}
