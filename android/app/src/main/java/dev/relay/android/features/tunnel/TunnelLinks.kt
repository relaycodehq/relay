package dev.relay.android.features.tunnel

import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.UriHandler
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.relay.android.lib.navigation.Navigator
import dev.relay.android.lib.navigation.Route
import dev.relay.android.remote.Bridge
import dev.relay.android.remote.Remote
import dev.relay.android.remote.tunnel.LocalUrls

/** Whether the computer tunnels ports: by its live bridge, or offline by the one its saved overview said. */
fun Remote.tunnels(): Boolean = ((client.value?.bridge ?: overview.value?.bridge) ?: 0) >= Bridge.TUNNEL

/** [tunnels], kept current as the computer connects and moves. */
@Composable
fun rememberTunnels(remote: Remote): Boolean {
    val client by remote.client.collectAsStateWithLifecycle()
    val overview by remote.overview.collectAsStateWithLifecycle()
    val status by remote.status.collectAsStateWithLifecycle()
    return remember(client, overview, status) { remote.tunnels() }
}

/**
 * Links an agent wrote to its own computer's localhost open in the phone's
 * browser, through the tunnel; everything else, and every link while the
 * computer can't tunnel, goes where [platform] sends it.
 */
@Composable
fun rememberTunnelLinks(remote: Remote, platform: UriHandler, navigator: Navigator): UriHandler =
    remember(remote, platform, navigator) {
        object : UriHandler {
            override fun openUri(uri: String) {
                if (LocalUrls.link(uri) != null && remote.tunnels()) navigator.push(Route.Browser(uri))
                else platform.openUri(uri)
            }
        }
    }
