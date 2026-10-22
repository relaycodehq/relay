package dev.relay.android.features.thread

import dev.relay.android.remote.model.ChatMessage
import dev.relay.android.remote.model.HtmlRender
import dev.relay.android.remote.model.HtmlRenderPage
import org.junit.Assert.*
import org.junit.Test

class ThreadMessageRowsTest {
    private fun message(id: String, renders: List<HtmlRender>? = null) = ChatMessage(
        id = id, role = "assistant", body = "An answer", status = "complete", created = 0,
        provider = "claude", version = 1, renders = renders,
    )
    private fun render(id: String) = HtmlRender(id, "Example", listOf(HtmlRenderPage()), 0)

    @Test fun bodyKeepsItsAnchorWhenCardsAreAddedOrReordered() {
        val original = threadMessageRows(listOf(message("answer")))
        val withCards = threadMessageRows(listOf(message("answer", listOf(render("one"), render("two")))))
        val reordered = threadMessageRows(listOf(message("answer", listOf(render("two"), render("one")))))
        assertEquals("answer", original.single().key)
        assertEquals("answer", withCards.last().key)
        assertEquals("answer", reordered.last().key)
        assertEquals(listOf("answer:header", "answer:render:one", "answer:render:two", "answer"), withCards.map { it.key })
        assertEquals(withCards.map { it.key }.toSet(), reordered.map { it.key }.toSet())
        assertEquals(MessageSection.Body, (withCards.last() as ThreadMessageRow.Content).section)
    }

    @Test fun noteNavigationFindsTheBeginningOfMessagesAfterRowExpansion() {
        val rows = threadMessageRows(listOf(message("first", listOf(render("one"))), message("second")))
        assertEquals(0, rows.indexOfFirst { it.message.id == "first" })
        assertEquals(3, rows.indexOfFirst { it.message.id == "second" })
        assertEquals(rows.size, rows.map { it.key }.distinct().size)
    }

    @Test fun syntheticMessagesKeepTheirExistingSpecialPresentation() {
        val m = message("summary", listOf(render("one"))).copy(compaction = true)
        val rows = threadMessageRows(listOf(m))
        assertEquals(1, rows.size)
        assertEquals(MessageSection.Whole, (rows.single() as ThreadMessageRow.Content).section)
    }
}
