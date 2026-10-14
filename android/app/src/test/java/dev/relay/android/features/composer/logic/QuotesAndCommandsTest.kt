package dev.relay.android.features.composer.logic

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

// Mirrors shared/composer-quotes.test.ts and shared/composer-commands.test.ts.
class QuotesAndCommandsTest {
    @Test fun `quotes a short message whole`() =
        assertEquals("> One\n> \n> \n> \n> Two\n\n", quoteMarkdown(quoteExcerpt("One\n\n\n\nTwo  ")))

    @Test fun `cuts at first lines and between words`() {
        val body = (1..12).joinToString("\n") { "line $it" }
        assertEquals("line 1\nline 2\nline 3 …", quoteExcerpt(body, 3))
        assertEquals("alpha beta …", quoteExcerpt("alpha beta gamma delta", 8, 13))
    }

    @Test fun `closes a cut fence before the ellipsis`() {
        assertEquals("> ```ts\n>   x\n> ```\n> \n> …\n\n", quoteMarkdown(quoteExcerpt("```ts\n  x  \n\n\n  y\n```", 2)))
        assertEquals("> ~~~js\n> code\n> ~~~\n\n…", quoteExcerpt("> ~~~js\n> code\n> more\n> ~~~", 2))
        assertEquals("> > text\n> \n> ```\n> x\n> ```\n\n", quoteMarkdown(quoteExcerpt("> text\n\n```\nx\n```")))
        assertEquals("```js\nx\n```", quoteExcerpt("```js\nx"))
    }

    @Test fun `no half emoji at the limit`() = assertEquals("abc …", quoteExcerpt("abc😅def", 8, 4))

    @Test fun `appends after the draft with the cursor below`() {
        val quote = quoteMarkdown("answer")
        assertEquals(Appended("My draft\n\n> answer\n\n", 20), appendQuote("My draft  ", quote))
        assertEquals(Appended(quote, quote.length), appendQuote("   ", quote))
    }

    private val catalogs: ModelCatalogs = mapOf(
        "codex" to listOf(AgentModel("gpt-6-luna", "GPT-6-Luna", efforts = listOf("low", "medium", "high"))),
        "claude" to listOf(AgentModel("opus", "Opus", efforts = listOf("low", "high", "max"), longContext = true)),
        "opencode" to listOf(AgentModel("anthropic/sonnet", "Sonnet", efforts = listOf("high"))),
    )

    private fun phone(recipient: String = "codex", model: String = "gpt-6-luna", fast: Boolean = false, plan: Boolean = false, cat: ModelCatalogs = catalogs) =
        CommandSettings(recipient, agentProviders, model, fast, plan, cat)

    private fun change(r: CommandResult) = (r as CommandResult.Change).change
    private fun error(r: CommandResult) = (r as CommandResult.Error).message

    @Test fun `model commands`() {
        assertEquals("Enter a valid model ID.", error(composerCommand("model", "not a model", phone())))
        assertEquals(ComposerChange.Model("codex", "gpt-7-preview"), change(composerCommand("model", "gpt-7-preview", phone())))
        assertEquals(ComposerChange.Model("codex", ""), change(composerCommand("model", "default", phone())))
        assertEquals(ComposerChange.Model("claude", "opus"), change(composerCommand("model", "Opus", phone())))
        assertEquals(ComposerChange.Model("claude", "opus[1m]"), change(composerCommand("model", "opus[1m]", phone())))
        assertEquals(ComposerChange.Model("opencode", "anthropic/sonnet"), change(composerCommand("model", "sonnet", phone())))
        assertEquals(
            listOf("claude:opus", "claude:opus[1m]", "claude:default", "codex:gpt-6-luna", "opencode:anthropic/sonnet"),
            modelCommandOptions("claude", catalogs, mapOf("claude" to "Opus")).map { "${it.provider}:${it.value}" },
        )
    }

    @Test fun `efforts follow the model`() {
        assertEquals(ComposerChange.Effort("high"), change(composerCommand("effort", "High", phone())))
        assertEquals("Choose one of: default, low, medium, high.", error(composerCommand("effort", "ultra", phone())))
        assertEquals(ComposerChange.Effort("max"), change(composerCommand("effort", "max", phone("claude", "opus"))))
        assertEquals(ComposerChange.Effort("ultra"), change(composerCommand("effort", "ultra", phone(model = "gpt-7-preview"))))
        assertEquals("Choose one of: default.", error(composerCommand("effort", "high", phone("opencode", ""))))
    }

    @Test fun `toggles and fast checks`() {
        assertEquals(ComposerChange.Plan(false), change(composerCommand("plan", "", phone(plan = true))))
        assertEquals(ComposerChange.Fast(true), change(composerCommand("fast", "ON", phone(fast = true))))
        assertEquals("Use /plan on or /plan off.", error(composerCommand("plan", "maybe", phone())))
        assertEquals(
            "Fast mode is only available for Codex and supported Cursor models.",
            error(composerCommand("fast", "", phone("claude"))),
        )
        val cursor = mapOf("cursor" to listOf(AgentModel("grok-4.7", "Grok", fast = true)))
        assertEquals(ComposerChange.Fast(true), change(composerCommand("fast", "on", phone("cursor", "grok-4.7", cat = cursor))))
        assertEquals(
            "Fast mode is not available for this Cursor model.",
            error(composerCommand("fast", "on", phone("cursor", "auto", cat = cursor))),
        )
        assertEquals(ComposerChange.Fast(false), change(composerCommand("fast", "off", phone("cursor", "auto", fast = true, cat = emptyMap()))))
        assertEquals(ComposerChange.Permissions("auto-accept-edits"), change(composerCommand("permissions", "Auto-accept edits", phone())))
    }

    @Test fun `relay commands and triggers`() {
        assertEquals(ParsedCommand("compact", "keep tests"), relayCommand("/compact keep tests"))
        assertNull(relayCommand("/context now"))
        assertEquals(false, startsWithCommand("/Users/me/clip.mp4"))
        val t = commandTrigger("fix it /mo")!!
        assertEquals('/', t.prefix)
        assertEquals("mo", t.query)
        assertEquals(true, t.inline)
        assertNull(commandTrigger("a/b"))
        assertEquals("Amp can't answer beside the thread. Pick Codex, Claude, OpenCode or Muse to ask a side question.", sideRefusal("amp"))
    }
}
