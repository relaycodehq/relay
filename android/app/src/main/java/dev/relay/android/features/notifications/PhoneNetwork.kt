package dev.relay.android.features.notifications

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.flow.distinctUntilChanged

/** The phone's default network, and whether Android found the internet over it. */
data class PhoneNet(val network: Network, val validated: Boolean)

/**
 * The phone's own network, null without one. A new value on every switch
 * (Wi-Fi to cellular) or change in reach, so a wait on it starts over.
 */
fun phoneNetwork(context: Context): Flow<PhoneNet?> = callbackFlow {
    val connectivity = context.getSystemService(ConnectivityManager::class.java)
    if (connectivity == null) {
        trySend(null)
        awaitClose()
        return@callbackFlow
    }
    fun net(network: Network?, caps: NetworkCapabilities?) =
        if (network == null || caps == null) null
        else PhoneNet(network, caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED))
    trySend(connectivity.activeNetwork.let { net(it, it?.let(connectivity::getNetworkCapabilities)) })
    val callback = object : ConnectivityManager.NetworkCallback() {
        override fun onCapabilitiesChanged(network: Network, caps: NetworkCapabilities) {
            trySend(net(network, caps))
        }

        override fun onLost(network: Network) {
            trySend(null)
        }
    }
    // Past the system's limit on callbacks this throws; then the first value stands.
    val registered = runCatching { connectivity.registerDefaultNetworkCallback(callback) }.isSuccess
    awaitClose { if (registered) connectivity.unregisterNetworkCallback(callback) }
}.distinctUntilChanged()
