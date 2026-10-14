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

class MainActivity : ComponentActivity() {
    private val links = Channel<Route>(Channel.BUFFERED)

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        // A restored activity already has the link's screen on its saved stack.
        if (savedInstanceState == null) deliver(intent)
        val container = (application as RelayApp).container
        setContent { RelayRoot(container, links) }
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
