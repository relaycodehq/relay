package dev.relay.android

import android.app.Application
import dev.relay.android.app.AppContainer

class RelayApp : Application() {
    lateinit var container: AppContainer
        private set

    override fun onCreate() {
        super.onCreate()
        container = AppContainer(this)
    }
}
