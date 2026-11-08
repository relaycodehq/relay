package dev.relay.android.features.images

import androidx.compose.foundation.Image
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.unit.sp
import dev.relay.android.remote.Remote
import dev.relay.android.ui.Spinner
import dev.relay.android.ui.Text

/** Input stays on the viewport; only the picture moves and scales. */
@Composable
internal fun LightboxPage(
    remote: Remote,
    image: LightboxImage,
    active: Boolean,
    onZoom: (Boolean) -> Unit,
    onPinchStart: () -> Unit,
    onTap: () -> Unit,
) {
    val loaded = rememberImage(remote, image.source)
    val picture = rememberPicture(loaded)
    val transform = remember { LightboxTransform() }
    val scope = rememberCoroutineScope()
    val pinchStarted by rememberUpdatedState(onPinchStart)
    val tapped by rememberUpdatedState(onTap)
    LaunchedEffect(active) {
        if (!active) transform.reset()
    }
    LaunchedEffect(active, transform.zoomed) {
        if (active) onZoom(transform.zoomed)
    }

    BoxWithConstraints(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        val width = constraints.maxWidth.toFloat()
        val height = constraints.maxHeight.toFloat()
        val ratio = loaded.bitmap?.let { it.width.toFloat() / it.height } ?: 0f
        LaunchedEffect(ratio, width, height) { transform.resize(ratio, width, height) }
        if (picture == null) {
            if (loaded.failed) Text("This image couldn’t be loaded.", color = Color.White.copy(alpha = 0.7f), style = TextStyle(fontSize = 14.sp))
            else Spinner(color = Color.White)
            return@BoxWithConstraints
        }
        Box(
            Modifier
                .fillMaxSize()
                .pointerInput(transform) {
                    detectTapGestures(onTap = { tapped() }, onDoubleTap = { transform.doubleTap(scope, it) })
                }
                .pointerInput(width, height, ratio) { detectLightboxGestures(transform) { pinchStarted() } },
        ) {
            Image(
                picture,
                image.name,
                Modifier.fillMaxSize().graphicsLayer {
                    translationX = transform.offset.x
                    translationY = transform.offset.y
                    scaleX = transform.scale
                    scaleY = transform.scale
                },
                contentScale = ContentScale.Fit,
            )
        }
    }
}
