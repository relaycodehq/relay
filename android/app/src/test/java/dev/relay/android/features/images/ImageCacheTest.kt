package dev.relay.android.features.images

import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.yield
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Test

class ImageCacheTest {
    @Test fun sharesConcurrentRequestsAndReusesLoadedImages() = runBlocking {
        val cache = ImageCache()
        val calls = AtomicInteger()
        val finish = CompletableDeferred<String>()
        val fetch: suspend () -> String = { calls.incrementAndGet(); finish.await() }
        val first = async { cache.load("computer:a@264", fetch) }
        val second = async { cache.load("computer:a@264", fetch) }
        yield()
        finish.complete("image")
        assertEquals("image", first.await())
        assertEquals("image", second.await())
        assertEquals("image", cache.load("computer:a@264", fetch))
        assertEquals(1, calls.get())
    }

    @Test fun keepsComputersAndSizesSeparate() = runBlocking {
        val cache = ImageCache()
        cache.load("one:a@264") { "small" }
        cache.load("one:a") { "full" }
        cache.load("two:a@264") { "other" }
        assertEquals("small", cache.get("one:a@264"))
        assertEquals("full", cache.get("one:a"))
        assertEquals("other", cache.get("two:a@264"))
    }

    @Test fun allowsAnotherAttemptAfterAFailure() = runBlocking {
        val cache = ImageCache()
        assertThrows(IllegalStateException::class.java) {
            runBlocking { cache.load("a") { error("offline") } }
        }
        assertEquals("online", cache.load("a") { "online" })
    }

    @Test fun evictsLeastRecentlyUsedAndSkipsOversized() = runBlocking {
        val cache = ImageCache()
        val big = "x".repeat(6 * 1024 * 1024)
        cache.load("a") { big }
        cache.load("b") { big }
        cache.get("a")
        cache.load("c") { big }
        assertEquals(big, cache.get("a"))
        assertNull(cache.get("b"))
        cache.load("huge") { "x".repeat(17 * 1024 * 1024) }
        assertNull(cache.get("huge"))
        assertEquals(big, cache.get("c"))
    }
}
