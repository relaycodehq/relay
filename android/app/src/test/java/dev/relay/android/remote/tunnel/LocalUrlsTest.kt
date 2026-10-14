package dev.relay.android.remote.tunnel

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class LocalUrlsTest {
    @Test fun `takes the links agents write to their own computer`() {
        assertEquals(SiteAddress(5177, "/previews/x/"), LocalUrls.link("http://localhost:5177/previews/x/"))
        assertEquals(SiteAddress(3000, "/?a=1#b"), LocalUrls.link("http://127.0.0.1:3000?a=1#b"))
        assertEquals(SiteAddress(8080), LocalUrls.link("HTTP://LOCALHOST:8080"))
        assertEquals(SiteAddress(5173, "/x"), LocalUrls.link("http://[::1]:5173/x"))
        assertEquals(SiteAddress(4321), LocalUrls.link("http://0.0.0.0:4321/"))
        assertEquals(SiteAddress(80), LocalUrls.link("http://localhost/"))
        // A dev certificate can't pass, and other hosts aren't the computer's.
        assertNull(LocalUrls.link("https://localhost:5177/"))
        assertNull(LocalUrls.link("http://localhost.example.com:5177/"))
        assertNull(LocalUrls.link("http://192.168.1.5:5177/"))
        assertNull(LocalUrls.link("http://localhost:70000/"))
        assertNull(LocalUrls.link("http://localhost:5177/a b"))
    }

    @Test fun `reads what someone types in the address bar`() {
        assertEquals(SiteAddress(5173), LocalUrls.typed("5173"))
        assertEquals(SiteAddress(5173, "/api"), LocalUrls.typed(" :5173/api "))
        assertEquals(SiteAddress(3000, "/x"), LocalUrls.typed("localhost:3000/x"))
        assertEquals(SiteAddress(3000), LocalUrls.typed("127.0.0.1:3000"))
        assertEquals(SiteAddress(3000), LocalUrls.typed("http://localhost:3000/"))
        assertNull(LocalUrls.typed(""))
        assertNull(LocalUrls.typed("0"))
        assertNull(LocalUrls.typed("example.com"))
        assertNull(LocalUrls.typed("vite"))
    }

    @Test fun `keeps the desktop's port where Android lets an app take it`() {
        assertEquals(5177, LocalUrls.preferredPort(5177))
        assertEquals(1024, LocalUrls.preferredPort(1024))
        assertEquals(0, LocalUrls.preferredPort(80))
        assertEquals(0, LocalUrls.preferredPort(443))
    }

    @Test fun `loads the desktop's own origin when the port is the same, and maps back`() {
        val page = SiteAddress(5177, "/previews/x/")
        assertEquals("http://localhost:5177/previews/x/", LocalUrls.local(page, 5177))
        assertEquals("http://127.0.0.1:41000/previews/x/", LocalUrls.local(page, 41000))
        val ports = mapOf(5177 to 5177, 41000 to 80)
        assertEquals(page, LocalUrls.desktop("http://localhost:5177/previews/x/", ports::get))
        assertEquals(SiteAddress(80, "/login"), LocalUrls.desktop("http://127.0.0.1:41000/login", ports::get))
        assertNull(LocalUrls.desktop("http://localhost:3000/", ports::get))
        assertEquals("localhost:5177/previews/x/", page.shown)
        assertEquals("localhost:80", SiteAddress(80).shown)
    }
}
