package dev.relay.android

import android.app.Application
import dev.relay.android.app.AppContainer
import dev.relay.android.app.CrashRecovery

class RelayApp : Application() {
    lateinit var container: AppContainer
        private set

    override fun onCreate() {
        super.onCreate()
        CrashRecovery.install(this)
        container = AppContainer(this)
    }
}
