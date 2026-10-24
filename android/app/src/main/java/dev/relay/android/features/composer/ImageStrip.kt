package dev.relay.android.features.composer

import android.graphics.BitmapFactory
import android.util.Base64
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import dev.relay.android.features.composer.logic.FilePhase
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.relay.android.ui.Icon
import dev.relay.android.ui.Text
import dev.relay.android.ui.pressable
import dev.relay.android.ui.ring
import dev.relay.android.ui.theme.Radii
import dev.relay.android.ui.theme.RelayTheme
import io.github.lyxnx.compose.ui.tablericons.TablerIcons
import io.github.lyxnx.compose.ui.tablericons.outline.DeviceLaptop
import io.github.lyxnx.compose.ui.tablericons.outline.File
import io.github.lyxnx.compose.ui.tablericons.outline.Movie
import io.github.lyxnx.compose.ui.tablericons.outline.X
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** The photos, videos and files going with the message and the computer's screenshots in this draft. */
@Composable
internal fun ImageStrip(
    images: List<Attachment>,
    computerShots: List<Int>,
    onRemove: (Int) -> Unit,
    files: List<PickedFile> = emptyList(),
    onRemoveFile: (String) -> Unit = {},
    onRetryFile: (String) -> Unit = {},
) {
    val c = RelayTheme.colors
    Row(Modifier.horizontalScroll(rememberScrollState()).padding(6.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        files.forEach { file ->
            Box {
                FileTile(file, onRetry = { onRetryFile(file.key) })
                Box(
                    Modifier.align(Alignment.TopEnd).offset(6.dp, (-6).dp).size(20.dp).background(c.background, CircleShape)
                        .pressable(onClick = { onRemoveFile(file.key) })
                        .semantics { contentDescription = "Remove ${file.name}" },
                    contentAlignment = Alignment.Center,
                ) { Icon(TablerIcons.Outline.X, null, size = 12.dp, tint = c.foreground) }
            }
        }
        images.forEachIndexed { i, image ->
            Box {
                Thumb(image.dataUrl)
                Box(
                    Modifier.align(Alignment.TopEnd).offset(6.dp, (-6).dp).size(20.dp).background(c.background, CircleShape)
                        .pressable(onClick = { onRemove(i) })
                        .semantics { contentDescription = "Remove ${image.name}" },
                    contentAlignment = Alignment.Center,
                ) { Icon(TablerIcons.Outline.X, null, size = 12.dp, tint = c.foreground) }
            }
        }
        computerShots.forEach { n ->
            Tile(if (n != 0) "Screenshot $n, on your computer" else "Screenshot on your computer") {
                Icon(TablerIcons.Outline.DeviceLaptop, null, size = 16.dp, tint = c.mutedForeground)
                Text("On computer", style = RelayTheme.type.xs.copy(fontSize = 10.sp, lineHeight = 12.sp), color = c.mutedForeground, textAlign = TextAlign.Center, maxLines = 2)
            }
        }
    }
}

/** A video or file: its name, and its size or how far it got; a failed upload tries again on a tap. */
@Composable
private fun FileTile(file: PickedFile, onRetry: () -> Unit) {
    val c = RelayTheme.colors
    val failed = file.phase == FilePhase.Failed
    val status = file.status
    Row(
        Modifier.height(56.dp).widthIn(max = 200.dp).clip(Radii.mdShape).ring(if (file.phase == FilePhase.Refused) c.destructive else c.border, Radii.mdShape)
            .then(if (failed) Modifier.pressable(onClick = onRetry) else Modifier)
            .semantics { contentDescription = if (status.isEmpty()) file.name else "${file.name}, $status" }
            .padding(horizontal = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Icon(if (file.video) TablerIcons.Outline.Movie else TablerIcons.Outline.File, null, size = 18.dp, tint = c.mutedForeground)
        Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(file.name, style = RelayTheme.type.xs, color = c.foreground, maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (status.isNotEmpty()) Text(
                status, style = RelayTheme.type.xs.copy(fontSize = 11.sp, lineHeight = 14.sp),
                color = if (failed || file.phase == FilePhase.Refused) c.destructive else c.mutedForeground, maxLines = 1,
            )
        }
    }
}

@Composable
private fun Tile(label: String, modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    Column(
        Modifier.size(56.dp).clip(Radii.mdShape).ring(RelayTheme.colors.border, Radii.mdShape).then(modifier)
            .semantics { contentDescription = label },
        verticalArrangement = Arrangement.spacedBy(2.dp, Alignment.CenterVertically),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) { content() }
}

/** Drawn from the prepared data URL: a camera shot's gallery copy is gone once it's read. */
@Composable
private fun Thumb(dataUrl: String) {
    val bitmap by produceState<ImageBitmap?>(null, dataUrl) {
        value = withContext(Dispatchers.Default) {
            runCatching {
                val bytes = Base64.decode(dataUrl.substringAfter(","), Base64.DEFAULT)
                val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
                BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
                var sample = 1
                while (maxOf(bounds.outWidth, bounds.outHeight) / (sample * 2) >= 168) sample *= 2
                BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = sample })?.asImageBitmap()
            }.getOrNull()
        }
    }
    val shape = Radii.mdShape
    Box(Modifier.size(56.dp).clip(shape).background(RelayTheme.colors.muted).ring(RelayTheme.colors.border, shape)) {
        bitmap?.let { Image(it, null, Modifier.size(56.dp), contentScale = ContentScale.Crop) }
    }
}
