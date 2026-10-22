package dev.relay.android

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import dev.relay.android.app.RelayRoot
import dev.relay.android.lib.navigation.Route
import dev.relay.android.lib.navigation.routeForDeepLink
import kotlinx.coroutines.channels.Channel
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.runtime.setValue
import dev.relay.android.app.Crash
import dev.relay.android.app.CrashRecovery
import dev.relay.android.app.splash.handOffSplash

class MainActivity : ComponentActivity() {
    private val links = Channel<Route>(Channel.BUFFERED)

    /** The crash this launch came back from, until the reader goes on to Home. */
    private var crash by mutableStateOf<Crash?>(null)

    /** The app settles from slightly zoomed in while the splash ribbon pulls away. */
    private val splashScale = mutableFloatStateOf(1f)

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        handOffSplash { splashScale.floatValue = it }
        // A restored activity already has the link's screen on its saved stack.
        if (savedInstanceState == null) {
            crash = CrashRecovery.take(intent)
            deliver(intent)
        }
        val container = (application as RelayApp).container
        // With the lock on, the recent apps show a blank card rather than the thread that was open.
        lifecycleScope.launch {
            container.lock.settings.map { it.on }.distinctUntilChanged().collect { setRecentsScreenshotEnabled(!it) }
        }
        setContent {
            Box(Modifier.fillMaxSize().graphicsLayer { splashScale.floatValue.let { scaleX = it; scaleY = it } }) {
                RelayRoot(container, links, crash) {
                    crash = null
                    CrashRecovery.seen()
                }
            }
        }
    }

    // Pickers and the camera come back with a result: a trip Relay sent the reader on, not a leave.
    // A plain startActivity (a link) comes through here too, with -1: that one is a leave.
    @Deprecated("Called by ActivityResultRegistry, not by Relay's code.")
    override fun startActivityForResult(intent: Intent, requestCode: Int, options: Bundle?) {
        if (requestCode >= 0) (application as RelayApp).container.lock.ownTrip()
        @Suppress("DEPRECATION")
        super.startActivityForResult(intent, requestCode, options)
    }

    // Back from the trip, even one too short for the app to have stopped, so the next leave isn't one.
    @Deprecated("Called by the framework; results go on to ActivityResultRegistry.")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        (application as RelayApp).container.lock.ownTripOver()
        @Suppress("DEPRECATION")
        super.onActivityResult(requestCode, resultCode, data)
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
