package dev.relay.android.features.tunnel

import android.content.Context
import android.webkit.CookieManager
import android.webkit.WebStorage
import android.webkit.WebView
import androidx.webkit.ProfileStore
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature

/**
 * Every computer's pages load as http://localhost:<port>, so on one shared
 * store a page from one computer would find another's cookies (which ignore
 * the port), storage and service workers. Where WebView has profiles each
 * computer gets its own; elsewhere the shared store is wiped when the browser
 * opens for another computer than last time.
 */
internal object BrowserProfiles {
    private const val PREFIX = "computer-"
    private const val PREFS = "relay-browser"
    private const val LAST = "computer"

    /** Puts [web], straight from its constructor, in [computer]'s profile. Main thread. */
    fun use(web: WebView, computer: String) {
        if (WebViewFeature.isFeatureSupported(WebViewFeature.MULTI_PROFILE)) {
            ProfileStore.getInstance().getOrCreateProfile(PREFIX + computer)
            WebViewCompat.setProfile(web, PREFIX + computer)
            return
        }
        val prefs = web.context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        if (prefs.getString(LAST, null) == computer) return
        wipe(web)
        prefs.edit().putString(LAST, computer).apply()
    }

    /** Deletes what computers no longer paired left behind. Main thread. */
    fun keepOnly(context: Context, computers: Set<String>) {
        if (WebViewFeature.isFeatureSupported(WebViewFeature.MULTI_PROFILE)) {
            val store = ProfileStore.getInstance()
            for (name in store.allProfileNames) {
                if (!name.startsWith(PREFIX) || name.removePrefix(PREFIX) in computers) continue
                // In use by a browser still open: it goes next time.
                runCatching { store.deleteProfile(name) }
            }
            return
        }
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val last = prefs.getString(LAST, null) ?: return
        if (last in computers) return
        wipe(null)
        prefs.edit().remove(LAST).apply()
    }

    private fun wipe(web: WebView?) {
        CookieManager.getInstance().removeAllCookies(null)
        WebStorage.getInstance().deleteAllData()
        // The HTTP cache is per app, not per WebView.
        web?.clearCache(true)
    }
}
