package dev.relay.android.app.gallery

import android.graphics.Bitmap
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.scrollBy
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.items
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import dev.relay.android.features.diagnostics.LocalScrollTrace
import dev.relay.android.features.diagnostics.ScrollDiagnostics
import dev.relay.android.features.diagnostics.scrollGeometry
import dev.relay.android.features.diagnostics.scrollTouches
import dev.relay.android.features.images.AnswerImageFrame
import dev.relay.android.features.images.LoadedImage
import dev.relay.android.features.markdown.Markdown
import dev.relay.android.features.thread.scroll.ThreadViewport
import dev.relay.android.features.thread.scroll.ContentSignature
import dev.relay.android.features.thread.scroll.stableGeometry
import dev.relay.android.features.thread.AgentRun
import dev.relay.android.features.thread.LocalReadingBack
import dev.relay.android.features.thread.rememberThreadScroll
import dev.relay.android.remote.model.AgentTrace
import dev.relay.android.remote.model.ChatMessage
import dev.relay.android.ui.Button
import dev.relay.android.ui.ButtonSize
import dev.relay.android.ui.Text
import dev.relay.android.ui.theme.RelayTheme
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** Deterministic geometry changes, using the thread's real list, native text, image and dock. No remote writes. */
@Composable
internal fun ScrollStabilityDemo() {
    val context = LocalContext.current
    val trace = remember { ScrollDiagnostics.of(context).trace("scroll-regression-sample", null, null) }
    val scroll = rememberThreadScroll(trace)
    val scope = rememberCoroutineScope()
    var image by remember { mutableIntStateOf(0) }
    var growth by remember { mutableIntStateOf(0) }
    var status by remember { mutableStateOf(true) }
    var draft by remember { mutableStateOf(true) }
    var stream by remember { mutableStateOf(false) }
    var running by remember { mutableStateOf(true) }
    val created = remember { System.currentTimeMillis() }
    val message = remember(running) { ChatMessage("sample-turn", "assistant", "", if (running) "streaming" else "complete",
        created, "claude", 1, trace = listOf(AgentTrace("commentary", "sample-trace", "Sample tool commentary stays open while reading back."))) }
    val bitmap = remember { Bitmap.createBitmap(320, 160, Bitmap.Config.ARGB_8888).apply { eraseColor(0xff507080.toInt()) }.asImageBitmap() }
    LaunchedEffect(stream) {
        if (stream) {
            repeat(20) { delay(300); growth++ }
            stream = false
        }
    }
    CompositionLocalProvider(LocalScrollTrace provides trace, LocalReadingBack provides !scroll.pinned) {
        Column(Modifier.fillMaxSize()) {
            FlowRow(Modifier.padding(8.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Button("Load image", { image = 1 }, size = ButtonSize.Xs)
                Button("Fail image", { image = 2 }, size = ButtonSize.Xs)
                Button("Stream", { stream = true }, size = ButtonSize.Xs)
                Button("Toggle status", { status = !status }, size = ButtonSize.Xs)
                Button("Toggle draft", { draft = !draft }, size = ButtonSize.Xs)
                Button("Up 6 px", { scope.launch {
                    scroll.list.scroll { scrollBy(-6f); withFrameNanos {} }
                } }, size = ButtonSize.Xs)
                Button("Bottom", { scroll.toBottom() }, size = ButtonSize.Xs)
                Button("Finish tools", { running = false }, size = ButtonSize.Xs)
            }
            Text("Sample data · pinned=${scroll.pinned} · image=$image", Modifier.padding(horizontal = 12.dp), style = RelayTheme.type.xs)
            ThreadViewport(scroll, (0..20).map { "sample-$it" } + "end",
                ContentSignature(22, "end", growth.toLong(), running.hashCode()),
                Modifier.weight(1f).fillMaxWidth().scrollGeometry(trace, "sample_list"), dock = {
                if (status) Box(Modifier.fillMaxWidth().height(48.dp).background(RelayTheme.colors.muted)) {
                    Text("Sample agent status", Modifier.padding(12.dp))
                }
                Box(Modifier.fillMaxWidth().height(if (draft) 80.dp else 32.dp).background(RelayTheme.colors.card)) {
                    Text("Sample composer", Modifier.padding(8.dp))
                }
            }) {
                items((0..20).toList(), key = { "sample-$it" }) { index ->
                    Column(Modifier.fillMaxWidth().then(if (index == 16) Modifier.stableGeometry(scroll.reading || scroll.touching) else Modifier).padding(12.dp).onSizeChanged {
                        trace.event("sample_row_size", "key" to "sample-$index", "heightPx" to it.height)
                    }) {
                        if (index == 16) AgentRun("scroll-regression-sample", message, null)
                        else if (index == 14) AnswerImageFrame(LoadedImage(if (image == 1) bitmap else null, image == 2), "Sample image", {})
                        else Markdown(
                            "Sample paragraph $index. **Stable text** stays in place while things above or below it change." +
                                if (index == 20) "\n\nMore sample text.".repeat(growth) else "",
                            native = true, selectable = true,
                        )
                    }
                }
                item("end") { Box(Modifier.height(1.dp)) }
            }

        }
    }
}
