package dev.relay.android.features.updates

import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** mobile/src/remote/latest-app.test.ts against the Kotlin store. */
class LatestAppTest {
    private val me = "dev.relay.android"
    private val newest = NewestApp(
        release = "0.10.2",
        version = "0.10.0",
        url = "https://example.test/Relay.apk",
        sha512 = "A".repeat(86) + "==",
        applicationId = me,
    )

    private var now = 1_791_504_000_000L
    private var saved: String? = null
    private var failSave = false
    private val answers = ArrayDeque<Result<NewestApp?>>()
    private var fetches = 0
    private val prefetched = mutableListOf<NewestApp>()
    private var metered: Boolean? = false

    private val storage = object : LatestAppStorage {
        override fun read() = saved
        override fun write(text: String) {
            if (failSave) {
                failSave = false
                throw IllegalStateException("storage full")
            }
            saved = text
        }
    }

    /** A fresh store over the same storage, as after a restart. */
    private fun store(release: Boolean = true, installed: String = "0.9.1") = LatestApp(
        fetch = {
            fetches++
            (answers.removeFirstOrNull() ?: Result.success(newest)).getOrThrow()
        },
        storage = storage,
        installed = installed,
        packageName = me,
        releaseBuild = release,
        metered = { metered },
        prefetch = { prefetched += it },
        now = { now },
        warn = { _, _ -> },
    )

    @Test fun keepsTheSixHourThrottleAcrossRestarts() = runBlocking {
        store().check()
        val restarted = store()
        restarted.check()
        assertEquals(1, fetches)
        now += 6 * 60 * 60_000
        restarted.check()
        assertEquals(2, fetches)
    }

    @Test fun keepsFailedCheckThrottlingAcrossRestartsAndRetriesAfterTenMinutes() = runBlocking {
        answers += Result.failure(Exception("offline"))
        store().check()
        val restarted = store()
        restarted.check()
        assertEquals(1, fetches)
        now += 10 * 60_000
        restarted.check()
        assertEquals(2, fetches)
    }

    @Test fun retriesAForcedFailureAfterTenMinutesEvenFollowingASuccess() = runBlocking {
        val s = store()
        s.check()
        answers += Result.failure(Exception("offline"))
        s.check(force = true)
        now += 10 * 60_000
        s.check()
        assertEquals(3, fetches)
    }

    @Test fun keepsTheNewerKnownAppWhenAnOlderSignedFeedIsReplayed() = runBlocking {
        val s = store()
        s.check()
        answers += Result.success(newest.copy(release = "0.9.1", version = "0.9.1"))
        s.check(force = true)
        assertEquals(newest, s.state.value.newest)
        assertTrue(s.state.value.error!!.contains("older release"))
    }

    @Test fun keepsANewerKnownApkWhenALaterFeedNamesAnOlderApp() = runBlocking {
        val s = store()
        s.check()
        answers += Result.success(newest.copy(release = "0.11.0", version = "0.9.1"))
        s.check(force = true)
        assertEquals(newest, s.state.value.newest)
        assertTrue(s.state.value.error!!.contains("older release or app"))
    }

    @Test fun replacesALegacyGuessWithANewerFeedsExactEntry() = runBlocking {
        val s = store()
        answers += Result.success(newest.copy(version = "0.10.2", sha512 = null))
        s.check()
        val exact = newest.copy(release = "0.10.3")
        answers += Result.success(exact)
        s.check(force = true)
        assertEquals(exact, s.state.value.newest)
        assertNull(s.state.value.error)
    }

    @Test fun doesNotPrefetchForADevelopmentBuildOrOnAMeteredNetwork() = runBlocking {
        store(release = false).check()
        metered = true
        now += 7 * 60 * 60_000
        store().check()
        metered = null
        now += 7 * 60 * 60_000
        store().check()
        assertEquals(emptyList<NewestApp>(), prefetched)
    }

    @Test fun neitherOffersNorPrefetchesAnotherAppsApk() = runBlocking {
        answers += Result.success(newest.copy(applicationId = null))
        val s = store()
        s.check()
        assertEquals(emptyList<NewestApp>(), prefetched)
        assertNull(s.offer())
        assertNull(s.state.value.error)
    }

    @Test fun aReleaseWithoutThisAppsApkIsNothingNewNotARollback() = runBlocking {
        val s = store()
        s.check()
        // The next release came without the native build: no entry, or only the Expo app's 0.8.
        answers += Result.success(null)
        s.check(force = true)
        answers += Result.success(newest.copy(release = "0.11.0", version = "0.8.3", applicationId = null))
        s.check(force = true)
        assertEquals(newest, s.state.value.newest)
        assertNull(s.state.value.error)
        assertEquals(3, fetches)
    }

    @Test fun recoversFromTheRollbackErrorTheExpoEntryLeftBehind() = runBlocking {
        val stuck = "The release feed went back to an older release or app."
        saved = Json.encodeToString(
            JsonObject.serializer(),
            buildJsonObject {
                put("newest", Json.encodeToJsonElement(NewestApp.serializer(), newest))
                put("checkedAt", now)
                put("triedAt", now)
                put("error", stuck)
            },
        )
        answers += Result.success(null)
        val s = store()
        s.check()
        assertEquals(stuck, s.state.value.error)
        now += 10 * 60_000
        s.check()
        assertNull(s.state.value.error)
        assertEquals(newest, s.state.value.newest)
        // An older build saved the Expo app's entry itself: it's dropped, so the next look goes ahead.
        saved = saved!!.replace("\"applicationId\":\"$me\"", "\"applicationId\":null")
        store().check()
        assertEquals(2, fetches)
    }

    @Test fun prefetchesACachedOfferWithoutLookingAgain() = runBlocking {
        store().check()
        prefetched.clear()
        store().check()
        assertEquals(1, fetches)
        assertEquals(listOf(newest), prefetched)
    }

    @Test fun offersNothingOnceInstalled() = runBlocking {
        val s = store(installed = "0.10.0")
        s.check()
        assertNull(s.offer())
        assertEquals(emptyList<NewestApp>(), prefetched)
    }

    @Test fun ignoresADamagedCache() = runBlocking {
        saved = """{"newest":{"version":42},"checkedAt":$now}"""
        val s = store()
        s.check()
        assertEquals(newest, s.state.value.newest)
        saved = """{"newest":{"release":"0.10.2","version":"x","url":"https://a.test/a.apk"},"checkedAt":$now}"""
        val again = store()
        again.check()
        assertEquals(2, fetches)
    }

    @Test fun handlesStorageFailureWithoutReportingANetworkError() = runBlocking {
        failSave = true
        val s = store()
        s.check()
        assertEquals(newest, s.state.value.newest)
        assertEquals(false, s.state.value.checking)
        assertNull(s.state.value.error)
    }

    @Test fun answersGitHubDidNotAnswerOnATimeout() = runBlocking {
        val s = LatestApp(
            fetch = { kotlinx.coroutines.delay(60_000); newest },
            storage = storage, installed = "0.9.1", packageName = me, releaseBuild = true,
            metered = { false }, prefetch = {}, now = { now }, timeoutMs = 10, warn = { _, _ -> },
        )
        s.check()
        assertEquals("GitHub didn't answer.", s.state.value.error)
    }
}
