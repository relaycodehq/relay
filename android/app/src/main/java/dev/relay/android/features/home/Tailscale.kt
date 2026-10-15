package dev.relay.android.features.home

import android.content.Context
import android.content.Intent
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext

/** The Tailscale app, which lets other apps ask it to connect (its IPNReceiver, there for automation apps). */
internal object Tailscale {
    private const val PACKAGE = "com.tailscale.ipn"

    fun installed(context: Context): Boolean =
        runCatching { context.packageManager.getPackageInfo(PACKAGE, 0) }.isSuccess

    /** Asks Tailscale to connect, as its own switch would. */
    fun connect(context: Context) {
        context.sendBroadcast(Intent("$PACKAGE.CONNECT_VPN").setClassName(PACKAGE, "$PACKAGE.IPNReceiver"))
    }

    fun open(context: Context) {
        context.packageManager.getLaunchIntentForPackage(PACKAGE)
            ?.let { runCatching { context.startActivity(it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) } }
    }
}

/** Whether a VPN is up on this phone (Android runs one at a time), kept current as it comes and goes. */
@Composable
internal fun rememberVpnUp(): Boolean {
    val context = LocalContext.current
    val connectivity = remember(context) { context.getSystemService(ConnectivityManager::class.java) }
    // Read once now, or the line would say Tailscale is off until the first callback.
    var up by remember {
        mutableStateOf(connectivity?.activeNetwork?.let(connectivity::getNetworkCapabilities)?.hasTransport(NetworkCapabilities.TRANSPORT_VPN) == true)
    }
    DisposableEffect(connectivity) {
        val networks = HashSet<Network>()
        val callback = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                networks += network
                up = true
            }

            override fun onLost(network: Network) {
                networks -= network
                up = networks.isNotEmpty()
            }
        }
        val request = NetworkRequest.Builder()
            .addTransportType(NetworkCapabilities.TRANSPORT_VPN)
            .removeCapability(NetworkCapabilities.NET_CAPABILITY_NOT_VPN)
            .build()
        connectivity?.registerNetworkCallback(request, callback)
        onDispose { connectivity?.unregisterNetworkCallback(callback) }
    }
    return up
}
