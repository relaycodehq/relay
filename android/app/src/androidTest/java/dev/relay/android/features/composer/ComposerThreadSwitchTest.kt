package dev.relay.android.features.composer

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.onRoot
import androidx.test.platform.app.InstrumentationRegistry
import android.graphics.Bitmap
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.unit.dp
import dev.relay.android.features.composer.logic.composeSend
import dev.relay.android.features.composer.logic.takesOver
import dev.relay.android.lib.navigation.LocalNavigator
import dev.relay.android.lib.navigation.Navigator
import dev.relay.android.lib.navigation.Route
import dev.relay.android.remote.OfflineCache
import dev.relay.android.remote.Remote
import dev.relay.android.remote.credentials.ComputerSeen
import dev.relay.android.remote.credentials.CredentialStore
import dev.relay.android.remote.model.ChatMessage
import dev.relay.android.remote.model.ChatScope
import dev.relay.android.remote.model.ModelChoice
import dev.relay.android.remote.model.RemoteChat
import dev.relay.android.remote.model.ResumeSettings
import dev.relay.android.ui.LocalToasts
import dev.relay.android.ui.Text
import dev.relay.android.ui.ToastState
import dev.relay.android.ui.theme.RelayTheme
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import java.io.File

/** Real composer, with a PC's mirrored thread snapshot and no live accounts or sends. */
class ComposerThreadSwitchTest {
    @get:Rule val compose = createComposeRule()
    private val opus = ResumeSettings("claude", ModelChoice("opus"), null, "auto", "default")
    private val gpt = opus.copy(provider = "codex", choice = ModelChoice("gpt-6-sol"))
    private val state = ComposerState(screenFollows = true)
    private var id by mutableStateOf("opus-thread")
    private val navigator = object : Navigator {
        override val stack = listOf(Route.Home)
        override val canGoBack = false
        override fun push(route: Route) {}
        override fun pop() = false
        override fun replace(route: Route) {}
        override fun openInPane(route: Route) {}
        override fun home() {}
    }

    private fun thread(id: String, settings: ResumeSettings) = RemoteChat(
        id, "sample-project", "Sample thread", scope = ChatScope("project"), running = true,
        // No thread-level settings: this is a thread mirrored from another computer.
        messages = listOf(
            ChatMessage("$id-send", "user", "Sample request", "complete", 1, settings.provider, 1, sentSettings = settings),
            ChatMessage("$id-answer", "assistant", "Sample answer", "streaming", 2, settings.provider, 1),
        ),
    )

    @Test fun opusToMirroredGptKeepsGptSelectedAndDoesNotRequestAnAgentSwitch() {
        state.chat = thread(id, opus)
        compose.setContent {
            val context = LocalContext.current
            val dir = File(context.cacheDir, "composer-switch-test")
            val remote = androidx.compose.runtime.remember {
                Remote(CredentialStore(File(dir, "credentials")), OfflineCache(File(dir, "offline")),
                    ComputerSeen(File(dir, "seen.json")), "test")
            }
            RelayTheme {
                CompositionLocalProvider(LocalNavigator provides navigator, LocalToasts provides ToastState()) {
                    Column(Modifier.fillMaxSize().background(RelayTheme.colors.background).padding(20.dp)) {
                        Text("Sample remote thread: $id")
                        Composer(remote, id, state)
                    }
                }
            }
        }
        compose.onNodeWithText("opus", substring = true).assertIsDisplayed()
        compose.runOnIdle {
            id = "gpt-thread"
            state.chat = thread(id, gpt)
        }
        compose.onNodeWithText("gpt-6-sol", substring = true).assertIsDisplayed()
        compose.runOnIdle {
            assertEquals(gpt, state.settings)
            assertFalse(takesOver(state.settings!!.provider, "codex"))
            assertEquals("gpt-6-sol", composeSend(state.settings!!, "Sample follow-up", "sample-send").choice.model)
        }
        val screenshot = compose.onRoot().captureToImage().asAndroidBitmap()
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        File(context.externalCacheDir, "relay-android-model-switch.png").outputStream().use {
            screenshot.compress(Bitmap.CompressFormat.PNG, 100, it)
        }
    }
}
