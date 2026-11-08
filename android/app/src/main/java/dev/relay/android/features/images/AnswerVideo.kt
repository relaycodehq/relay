package dev.relay.android.features.images

import android.content.Context
import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.common.VideoSize
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.PlayerView
import dev.relay.android.remote.Bridge
import dev.relay.android.remote.Remote
import dev.relay.android.ui.Icon
import dev.relay.android.ui.ProgressBar
import dev.relay.android.ui.Text
import dev.relay.android.ui.pressable
import dev.relay.android.ui.ring
import dev.relay.android.ui.theme.RelayTheme
import io.github.lyxnx.compose.ui.tablericons.TablerIcons
import io.github.lyxnx.compose.ui.tablericons.filled.PlayerPlay
import java.io.File
import java.util.Locale
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long

private const val ANSWER_HEIGHT = 420

private sealed interface VideoState {
    data object Waiting : VideoState
    data class Loading(val done: Long, val size: Long) : VideoState
    /** A video played before is ready from the cache, but waits for its own tap. */
    data class Playing(val file: File, val autoplay: Boolean) : VideoState
    data class Failed(val reason: String) : VideoState
}

private object SharedVideoFiles {
    @Volatile private var files: VideoFiles? = null

    fun of(context: Context): VideoFiles = files ?: synchronized(this) {
        files ?: VideoFiles(File(context.cacheDir, "answer-videos")).also { files = it }
    }
}

/**
 * A video an answer embeds. The computer can't stream it to the phone, so a
 * tap downloads it into the cache and then plays it; the frame keeps its
 * height through all of that, so the answer below doesn't move.
 */
@Composable
fun AnswerVideo(
    remote: Remote,
    chatId: String,
    messageId: String,
    path: String,
    alt: String,
    ready: Boolean,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val overview by remote.overview.collectAsState()
    val computer by remote.active.collectAsState()
    val files = remember(context) { SharedVideoFiles.of(context) }
    val key = "$computer|$chatId|$messageId|$path"
    val name = alt.ifEmpty { path.substringAfterLast('/').substringAfterLast('\\') }
    val cached = remember(key) { files.fileFor(key, path).takeIf { it.exists() } }
    var state by remember(key) { mutableStateOf(cached?.let { VideoState.Playing(it, autoplay = false) } ?: VideoState.Waiting) }
    var ratio by remember(key) { mutableStateOf(16f / 9) }
    val supported = (overview?.bridge ?: 1) >= Bridge.VIDEO

    fun start() {
        val client = remote.client.value ?: return
        state = VideoState.Loading(0, 0)
        scope.launch {
            state = try {
                val file = files.download(key, path, fetch = { offset ->
                    val part = client.desktop(
                        "projectChatVideoPart",
                        listOf(JsonPrimitive(chatId), JsonPrimitive(messageId), JsonPrimitive(path), JsonPrimitive(offset)),
                    ).jsonObject
                    VideoPart(part.getValue("size").jsonPrimitive.long, part.getValue("data").jsonPrimitive.content)
                }) { done, size -> state = VideoState.Loading(done, size) }
                VideoState.Playing(file, autoplay = true)
            } catch (e: CancellationException) {
                throw e
            } catch (e: VideoTooBig) {
                VideoState.Failed("Too big to play here (${megabytes(e.size)})")
            } catch (_: Exception) {
                VideoState.Failed("Couldn't load the video")
            }
        }
    }

    val c = RelayTheme.colors
    val shape = RoundedCornerShape(10.dp)
    BoxWithConstraints(modifier.fillMaxWidth()) {
        val height = minOf(maxWidth / ratio, ANSWER_HEIGHT.dp)
        val width = minOf(maxWidth, height * ratio)
        val playing = state as? VideoState.Playing
        val tap: (() -> Unit)? = when {
            playing != null || !ready || !supported -> null
            state is VideoState.Loading -> null
            else -> ::start
        }
        Box(
            Modifier.width(width).height(height).clip(shape).background(c.muted).ring(c.border, shape)
                .then(if (tap != null) Modifier.pressable(tap, role = Role.Button, scale = false) else Modifier),
            contentAlignment = Alignment.Center,
        ) {
            if (playing != null) VideoPlayer(playing.file, playing.autoplay, onRatio = { ratio = it }, Modifier.fillMaxSize())
            else Column(
                Modifier.padding(16.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                when (val s = state) {
                    is VideoState.Loading -> {
                        val progress = if (s.size > 0) s.done.toFloat() / s.size else null
                        ProgressBar(progress, Modifier.width(140.dp))
                        Text(if (s.size > 0) "${megabytes(s.done)} of ${megabytes(s.size)}" else "Loading…", color = c.mutedForeground)
                    }
                    is VideoState.Failed -> {
                        Text(s.reason, color = c.mutedForeground, textAlign = TextAlign.Center)
                        if (supported) Text("Tap to try again", color = c.foreground)
                    }
                    else -> {
                        if (supported) PlayButton(dim = !ready)
                        Text(name, color = c.mutedForeground, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        if (!supported) Text("Update Relay on the computer to play videos here", color = c.mutedForeground, textAlign = TextAlign.Center)
                    }
                }
            }
        }
    }
}

@Composable
private fun PlayButton(dim: Boolean) {
    val c = RelayTheme.colors
    Box(
        Modifier.size(48.dp).clip(CircleShape).background(c.background.copy(alpha = 0.85f)).ring(c.border, CircleShape),
        contentAlignment = Alignment.Center,
    ) {
        Icon(TablerIcons.Filled.PlayerPlay, "Play", tint = if (dim) c.mutedForeground else c.foreground)
    }
}

/** Plays the downloaded file inline, pausing while the app is in the background. */
@Composable
private fun VideoPlayer(file: File, autoplay: Boolean, onRatio: (Float) -> Unit, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val player = remember(file) {
        ExoPlayer.Builder(context).build().apply {
            setMediaItem(MediaItem.fromUri(Uri.fromFile(file)))
            playWhenReady = autoplay
            prepare()
        }
    }
    DisposableEffect(player, lifecycle) {
        val sized = object : Player.Listener {
            override fun onVideoSizeChanged(size: VideoSize) {
                if (size.width > 0 && size.height > 0) onRatio(size.width * size.pixelWidthHeightRatio / size.height)
            }
        }
        val paused = LifecycleEventObserver { _, event -> if (event == Lifecycle.Event.ON_PAUSE) player.pause() }
        player.addListener(sized)
        lifecycle.addObserver(paused)
        onDispose {
            lifecycle.removeObserver(paused)
            player.release()
        }
    }
    AndroidView(
        factory = { PlayerView(it).apply { this.player = player } },
        modifier = modifier,
        onRelease = { it.player = null },
    )
}

private fun megabytes(bytes: Long) = String.format(Locale.ROOT, "%.1fMB", bytes / 1_048_576.0)
