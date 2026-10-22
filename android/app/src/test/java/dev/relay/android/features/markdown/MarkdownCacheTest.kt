package dev.relay.android.features.markdown

import org.junit.Assert.*
import org.junit.Test

class MarkdownCacheTest {
    @Test fun appendedReferenceDefinitionUpdatesEarlierBlockWithoutChangingAnchor() {
        val cache = MarkdownCache()
        val before = cache.positioned("See [docs][ref].\n\nTail")
        val source = "See [docs][ref].\n\nTail\n\n[ref]: https://example.com"
        val after = cache.positioned(source)
        assertEquals(before.first().sourceLine, after.first().sourceLine)
        assertEquals(parseMarkdown(source), after.map { it.block })
        assertTrue((after.first().block as MdBlock.Para).inlines.any { it is MdInline.Link })
        val removed = "See [docs][ref].\n\nTail"
        assertEquals(parseMarkdown(removed), cache.positioned(removed).map { it.block })
    }

    @Test fun streamingPrefixRetainsBlockInstancesAndNormalizedSourceLines() {
        val cache = MarkdownCache()
        val first = cache.positioned("First\n\n\\[x^2\\]\n\nTail")
        val next = cache.positioned("First\n\n\\[x^2\\]\n\nTail grows")
        assertEquals(listOf(0, 2, 6), next.map { it.sourceLine })
        assertSame(first.first().block, next.first().block)
        assertEquals(first.map { it.sourceLine }, next.map { it.sourceLine })
    }
}
