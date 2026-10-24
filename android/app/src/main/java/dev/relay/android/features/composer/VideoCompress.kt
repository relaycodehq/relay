package dev.relay.android.features.composer

import android.content.Context
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.os.Handler
import android.os.Looper
import androidx.annotation.OptIn
import androidx.media3.common.Effect
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.util.UnstableApi
import androidx.media3.effect.FrameDropEffect
import androidx.media3.effect.Presentation
import androidx.media3.transformer.Composition
import androidx.media3.transformer.DefaultEncoderFactory
import androidx.media3.transformer.EditedMediaItem
import androidx.media3.transformer.EditedMediaItemSequence
import androidx.media3.transformer.Effects
import androidx.media3.transformer.ExportException
import androidx.media3.transformer.ExportResult
import androidx.media3.transformer.Transformer
import androidx.media3.transformer.VideoEncoderSettings
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import java.io.File
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

private const val SHORT_SIDE = 720
private const val VIDEO_BITRATE = 2_500_000
private const val MAX_FPS = 30f

/** The video's short side in pixels, null when it can't be read. */
private fun shortSide(context: Context, uri: Uri): Int? = runCatching {
    MediaMetadataRetriever().use { r ->
        r.setDataSource(context, uri)
        val w = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH)?.toIntOrNull()
        val h = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT)?.toIntOrNull()
        if (w == null || h == null) null else minOf(w, h)
    }
}.getOrNull()

/**
 * Writes [source] to [out] small enough to send: H.264 at 720p on its short
 * side (never scaled up), about 2.5 Mbps, at most 30 fps, HDR toned down to
 * SDR, its sound kept as AAC. Throws when the phone can't.
 */
@OptIn(UnstableApi::class)
suspend fun compressVideo(context: Context, source: Uri, out: File) {
    val short = withContext(Dispatchers.IO) { shortSide(context, source) }
    val effects = buildList<Effect> {
        if (short == null || short > SHORT_SIDE) add(Presentation.createForShortSide(SHORT_SIDE))
        add(FrameDropEffect.createDefaultFrameDropEffect(MAX_FPS))
    }
    val item = EditedMediaItem.Builder(MediaItem.fromUri(source)).setEffects(Effects(emptyList(), effects)).build()
    val composition = Composition.Builder(EditedMediaItemSequence.Builder(item).build())
        .setHdrMode(Composition.HDR_MODE_TONE_MAP_HDR_TO_SDR_USING_OPEN_GL)
        .build()
    out.delete()
    // Transformer runs on the thread that made it, which needs a Looper.
    withContext(Dispatchers.Main) {
        suspendCancellableCoroutine { done ->
            val transformer = Transformer.Builder(context)
                .setVideoMimeType(MimeTypes.VIDEO_H264)
                .setAudioMimeType(MimeTypes.AUDIO_AAC)
                .setEncoderFactory(
                    DefaultEncoderFactory.Builder(context)
                        .setRequestedVideoEncoderSettings(VideoEncoderSettings.Builder().setBitrate(VIDEO_BITRATE).build())
                        .setEnableFallback(true)
                        .build(),
                )
                .addListener(object : Transformer.Listener {
                    override fun onCompleted(composition: Composition, exportResult: ExportResult) = done.resume(Unit)
                    override fun onError(composition: Composition, exportResult: ExportResult, exportException: ExportException) =
                        done.resumeWithException(exportException)
                })
                .build()
            val main = Handler(Looper.getMainLooper())
            done.invokeOnCancellation {
                main.post {
                    transformer.cancel()
                    out.delete()
                }
            }
            transformer.start(composition, out.path)
        }
    }
}
