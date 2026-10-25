package dev.relay.android

import android.app.Application
import dev.relay.android.app.AppContainer
import dev.relay.android.app.CrashRecovery
import dev.relay.android.features.notifications.StopsRelay

class RelayApp : Application(), StopsRelay {
    lateinit var container: AppContainer
        private set

    override fun onCreate() {
        super.onCreate()
        CrashRecovery.install(this)
        container = AppContainer(this)
    }

    override fun stopRelay() = container.relayStop.stop()
}
