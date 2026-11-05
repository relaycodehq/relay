package dev.relay.android.lib.navigation

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class DeepLinksTest {
    @Test fun `a notification's link keeps the computer its thread is on`() {
        val link = threadLink("chat 1/x", "computer&2")
        assertEquals(DeepLink(Route.Thread("chat 1/x"), "computer&2"), deepLinkFor(link))
    }

    @Test fun `a thread link without a computer opens on the one that's active`() {
        assertEquals(DeepLink(Route.Thread("abc")), deepLinkFor("relay-native://chat/abc"))
        assertEquals(DeepLink(Route.Thread("abc")), deepLinkFor(threadLink("abc", null)))
        assertEquals(DeepLink(Route.Thread("abc")), deepLinkFor("relay-native://chat/abc?computer="))
    }

    @Test fun `pairing links and unknown ones read as before`() {
        assertEquals(DeepLink(Route.Pair("relay-remote://pair?x=1")), deepLinkFor("relay-native://pair?x=1"))
        assertNull(deepLinkFor("relay-native://chat/%zz"))
        assertNull(deepLinkFor("https://chat/abc"))
        assertNull(deepLinkFor("relay-native://other/abc"))
    }
}
