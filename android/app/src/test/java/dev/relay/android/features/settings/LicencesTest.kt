package dev.relay.android.features.settings

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class LicencesTest {
    @Test fun `the shipped notices read as titled sections`() {
        val blocks = noticeBlocks(File("src/main/assets/$NOTICES_ASSET").readText())
        assertTrue(blocks.first().heading)
        val titles = blocks.filter { it.heading }.map { it.text }
        assertTrue("Apache License 2.0" in titles)
        // Every section carries something under its title.
        blocks.zipWithNext().forEach { (a, b) -> assertTrue("${a.text} is empty", !(a.heading && b.heading)) }
        assertTrue(!blocks.last().heading)
    }

    @Test fun `paragraphs keep their line breaks`() {
        val blocks = noticeBlocks("# Lib\n\na:b 1\nc:d 2\n\n\nText")
        assertEquals(listOf(NoticeBlock("Lib", true), NoticeBlock("a:b 1\nc:d 2", false), NoticeBlock("Text", false)), blocks)
    }
}
