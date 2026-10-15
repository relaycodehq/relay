package dev.relay.android.remote.client

import dev.relay.android.remote.crypto.Base64Url
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

internal data class Endpoint(val hosts: List<String>, val port: Int, val key: String)

internal interface Race {
    fun stale(): Boolean
    fun claim(link: Link): Boolean
    fun failed(error: Exception) {}
    fun done()
}

/** The routes being dialled, for connecting and for looking for a better route beside a running link. */
internal class RouteRacer(private val owner: DialOwner, private val staggerMs: Long) {
    private val dials = LinkedHashSet<Dial>()

    val dialing: Boolean get() = dials.isNotEmpty()

    fun cancelAll() {
        for (d in dials.toList()) d.cancel()
        dials.clear()
    }

    /**
     * Dials the hosts in order, each a little after the one before unless that
     * one already failed, and keeps the first that signs in. A pairing code
     * works once, so when [pairing], the first channel to open alone sends it.
     */
    fun race(endpoint: Endpoint, pairing: Boolean, order: List<String>, on: Race) {
        val (_, port, key) = endpoint
        val serverKey = Base64Url.decodeOrNull(key)
        if (serverKey == null || serverKey.size != 32) {
            on.failed(Exception("Couldn't verify ${owner.name}. Pair again."))
            return on.done()
        }
        val mine = LinkedHashSet<Dial>()
        var next = 0
        var won = false
        var signing: Dial? = null
        var timer: Job? = null
        fun settle() {
            timer?.cancel()
            for (d in mine.toList()) {
                d.cancel()
                dials.remove(d)
            }
        }
        fun dialNext() {
            timer?.cancel()
            if (won || signing != null || on.stale() || next >= order.size) return
            val host = order[next++]
            val dial = Dial(host, port, serverKey, owner, object : DialHandlers {
                override fun signIn(dial: Dial): Boolean {
                    if (!pairing) return true
                    if (won || signing != null || on.stale()) return false
                    signing = dial
                    timer?.cancel()
                    for (other in mine.toList()) if (other !== dial) {
                        other.cancel()
                        mine.remove(other)
                        dials.remove(other)
                    }
                    return true
                }
                override fun claim(dial: Dial, link: Link): Boolean {
                    mine.remove(dial)
                    dials.remove(dial)
                    if (won || on.stale() || !on.claim(link)) return false
                    won = true
                    settle()
                    return true
                }
                override fun failed(dial: Dial, error: Exception) {
                    mine.remove(dial)
                    dials.remove(dial)
                    if (signing === dial) signing = null
                    if (won || on.stale()) return
                    on.failed(error)
                    // A refusal from the pinned desktop holds for every route.
                    if (error is Denied) return settle()
                    if (next < order.size) dialNext() else if (mine.isEmpty()) on.done()
                }
            })
            mine.add(dial)
            dials.add(dial)
            if (next < order.size) timer = owner.scope.launch {
                delay(staggerMs)
                dialNext()
            }
        }
        if (order.isEmpty()) on.done() else dialNext()
    }
}
