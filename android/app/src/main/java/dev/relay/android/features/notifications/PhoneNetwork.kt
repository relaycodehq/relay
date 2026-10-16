package dev.relay.android.features.notifications

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.flow.distinctUntilChanged

/**
 * The phone's own network while it reaches the internet, null without one. A
 * new value on every switch (Wi-Fi to cellular), so a wait on it starts over.
 */
fun phoneNetwork(context: Context): Flow<Network?> = callbackFlow {
    val connectivity = context.getSystemService(ConnectivityManager::class.java)
    if (connectivity == null) {
        trySend(null)
        awaitClose()
        return@callbackFlow
    }
    fun working(network: Network?, caps: NetworkCapabilities?) =
        network?.takeIf { caps?.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED) == true }
    trySend(connectivity.activeNetwork.let { working(it, it?.let(connectivity::getNetworkCapabilities)) })
    val callback = object : ConnectivityManager.NetworkCallback() {
        override fun onCapabilitiesChanged(network: Network, caps: NetworkCapabilities) {
            trySend(working(network, caps))
        }

        override fun onLost(network: Network) {
            trySend(null)
        }
    }
    connectivity.registerDefaultNetworkCallback(callback)
    awaitClose { connectivity.unregisterNetworkCallback(callback) }
}.distinctUntilChanged()
