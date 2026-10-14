package dev.relay.android.features.updates

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.async
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** mobile/src/remote/apk-install.test.ts against the Kotlin installer. */
@OptIn(ExperimentalCoroutinesApi::class)
class ApkInstallerTest {
    private val desktop = ApkOffer("0.10.0", "https://example.test/desktop.apk")
    private val feed = ApkOffer("0.10.0", "https://example.test/feed.apk", "checksum")

    private class FakeNative : ApkNative {
        var can = false
        val downloads = mutableListOf<Triple<String, String, String>>()
        val held = ArrayDeque<CompletableDeferred<String>>()
        var downloadFails: Exception? = null
        var onDownload: () -> Unit = {}
        var installs = 0
        var allows = 0
        val opened = mutableListOf<String>()
        var openFails: Exception? = null
        val foreground = mutableListOf<() -> Unit>()

        override fun canInstall() = can
        override fun allowInstalls() { allows++ }
        override suspend fun download(url: String, version: String, sha512: String, onProgress: (Float) -> Unit): String {
            downloads += Triple(url, version, sha512)
            onDownload()
            downloadFails?.let { downloadFails = null; throw it }
            return held.removeFirstOrNull()?.await() ?: "/cache/Relay.apk"
        }
        var silent = false
        val quietInstalls = mutableListOf<Boolean>()
        override suspend fun install(path: String, quiet: Boolean): InstallOutcome {
            installs++
            quietInstalls += quiet
            return InstallOutcome.Cancelled
        }
        override fun installsSilently() = silent
        override fun metered(): Boolean? = false
        override fun openUrl(url: String) {
            opened += url
            openFails?.let { openFails = null; throw it }
        }
        override fun onForeground(listener: () -> Unit): AutoCloseable {
            foreground += listener
            return AutoCloseable { foreground.remove(listener) }
        }
        fun cameBack() = foreground.toList().forEach { it() }
    }

    private val native = FakeNative()
    private var pending = "0.9.1"
    private fun TestScope.installer() = ApkInstaller(native, backgroundScope, { pending }, warn = { _, _ -> })

    @Test fun opensOnePermissionScreenAndLeavesOneListenerForSimultaneousTaps() = runTest(UnconfinedTestDispatcher()) {
        val i = installer()
        val finish = CompletableDeferred<String>().also { native.held += it }
        val a = async { i.install(feed) }
        val b = async { i.install(feed) }
        finish.complete("/cache/Relay.apk")
        a.await(); b.await()
        assertEquals(1, native.downloads.size)
        assertEquals(1, native.allows)
        assertEquals(1, native.foreground.size)
        i.install(feed)
        assertEquals(2, native.downloads.size)
        assertEquals(1, native.foreground.size)
        native.can = true
        native.cameBack()
        advanceUntilIdle()
        assertEquals(1, native.installs)
        assertEquals(0, native.foreground.size)
    }

    @Test fun checksTheFeedsChecksumAfterJoiningADesktopDownloadOfTheSameVersion() = runTest(UnconfinedTestDispatcher()) {
        val i = installer()
        val finish = CompletableDeferred<String>().also { native.held += it }
        native.can = true
        i.prefetch(desktop)
        assertEquals(1, native.downloads.size)
        val requested = async { i.install(feed) }
        finish.complete("/cache/Relay.apk")
        requested.await()
        assertEquals(
            listOf(Triple(desktop.url, desktop.version, ""), Triple(feed.url, feed.version, "checksum")),
            native.downloads,
        )
        assertEquals(1, native.installs)
    }

    @Test fun waitsForAnOlderPrefetchInsteadOfSwallowingANewerTap() = runTest(UnconfinedTestDispatcher()) {
        val i = installer()
        val finish = CompletableDeferred<String>().also { native.held += it }
        native.can = true
        i.prefetch(desktop)
        val newer = feed.copy(version = "0.11.0")
        val requested = async { i.install(newer) }
        finish.complete("/cache/Relay.apk")
        requested.await()
        assertEquals(Triple(newer.url, newer.version, "checksum"), native.downloads.last())
        assertEquals(1, native.installs)
    }

    @Test fun aQuietPrefetchThatFailsStaysQuiet() = runTest(UnconfinedTestDispatcher()) {
        val i = installer()
        native.downloadFails = Exception("offline")
        i.prefetch(feed)
        assertEquals(ApkInstall.Idle, i.state.value)
        native.downloadFails = Exception("offline")
        i.install(feed)
        assertEquals(ApkInstall.Failed("0.10.0", "offline"), i.state.value)
    }

    @Test fun usesTheBrowserForADevelopmentBuildAndHandlesAnUnavailableBrowser() = runTest(UnconfinedTestDispatcher()) {
        val i = installer()
        native.openFails = Exception("no browser")
        i.install(feed, browser = true)
        assertEquals(listOf(feed.url), native.opened)
        assertEquals(ApkInstall.Failed("0.10.0", "no browser"), i.state.value)
        assertTrue(native.downloads.isEmpty())
        i.install(feed, browser = true)
        assertEquals(ApkInstall.Idle, i.state.value)
    }

    @Test fun refusesAnApkWhenNewerCodeArrivedDuringItsDownload() = runTest(UnconfinedTestDispatcher()) {
        val i = installer()
        native.onDownload = { pending = "0.11.0" }
        i.install(feed)
        val s = i.state.value
        assertTrue(s is ApkInstall.Failed && s.message.contains("older code"))
        assertEquals(0, native.installs)
        assertEquals(0, native.allows)
    }

    @Test fun rechecksAfterReturningFromThePermissionScreen() = runTest(UnconfinedTestDispatcher()) {
        val i = installer()
        i.install(feed)
        pending = "0.11.0"
        native.can = true
        native.cameBack()
        val s = i.state.value
        assertTrue(s is ApkInstall.Failed && s.message.contains("older code"))
        assertEquals(0, native.installs)
    }

    @Test fun noticesAnAlreadyGrantedPermissionWithoutAForegroundEvent() = runTest(UnconfinedTestDispatcher()) {
        val i = installer()
        i.install(feed)
        native.can = true
        i.install(feed)
        assertEquals(1, native.installs)
        assertEquals(0, native.foreground.size)
    }

    @Test fun checksANewlyAvailableChecksumWhenRetryingTheSameVersion() = runTest(UnconfinedTestDispatcher()) {
        val i = installer()
        i.install(desktop)
        i.install(feed)
        assertEquals(Triple(feed.url, feed.version, "checksum"), native.downloads.last())
        assertEquals(2, native.downloads.size)
        assertEquals(1, native.foreground.size)
    }

    @Test fun installsQuietlyOnlyADownloadedUpdateAndOnlyWhenAndroidWontAsk() = runTest(UnconfinedTestDispatcher()) {
        val i = installer()
        native.can = true
        // Nothing downloaded yet: leaving the app does nothing.
        i.installQuietly(feed)
        assertEquals(0, native.installs)
        i.prefetch(feed)
        assertEquals(ApkInstall.Downloaded("0.10.0"), i.state.value)
        // Android would still prompt (the first update), so it waits for a tap.
        i.installQuietly(feed)
        assertEquals(0, native.installs)
        native.silent = true
        i.installQuietly(feed.copy(version = "0.11.0"))
        assertEquals(0, native.installs)
        i.installQuietly(feed)
        assertEquals(listOf(true), native.quietInstalls)
    }

    @Test fun neverInstallsQuietlyOverNewerCode() = runTest(UnconfinedTestDispatcher()) {
        val i = installer()
        native.can = true
        native.silent = true
        i.prefetch(feed)
        pending = "0.12.0"
        i.installQuietly(feed)
        assertEquals(0, native.installs)
    }
}
