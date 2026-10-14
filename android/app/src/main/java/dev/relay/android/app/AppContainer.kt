package dev.relay.android.app

import android.content.Context

/**
 * The app's object graph, built once in RelayApp. Wire services here and hand
 * them to screens from the entries in Entries.kt; nothing reaches for a global.
 */
class AppContainer(context: Context) {
    val prefs = ShellPrefs(context.applicationContext)

    // The bridge slot: `val remote = RemoteClient(...)` once remote/ is ready,
    // plus the stores screens read (overview, chats, drafts).
}
