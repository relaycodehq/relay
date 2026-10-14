package dev.relay.android.features.home

import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import coil3.compose.AsyncImage
import dev.relay.android.remote.model.RemoteProject
import dev.relay.android.ui.Icon
import dev.relay.android.ui.ProjectBadge
import dev.relay.android.ui.theme.RelayTheme
import io.github.lyxnx.compose.ui.tablericons.TablerIcons
import io.github.lyxnx.compose.ui.tablericons.outline.Folder
import io.github.lyxnx.compose.ui.tablericons.outline.Notebook
import java.io.File

/** The saved icon file of a project on the active computer, or null; Home provides it. */
val LocalProjectIconPath = compositionLocalOf<(String) -> String?> { { null } }

/** The project's own icon, as the desktop's sidebar shows it; its folder otherwise. */
@Composable
fun ProjectIcon(project: RemoteProject, modifier: Modifier = Modifier, size: Dp = 17.dp) {
    val muted = RelayTheme.colors.mutedForeground
    if (project.scratch == true) return Icon(TablerIcons.Outline.Notebook, null, modifier, tint = muted, size = size)
    IconFile(LocalProjectIconPath.current(project.id), modifier.size(size), RoundedCornerShape(4.dp)) {
        Icon(TablerIcons.Outline.Folder, null, modifier, tint = muted, size = size)
    }
}

/** The desktop's card badge: the project's icon, else its initial on its colour. */
@Composable
fun ProjectCardBadge(id: String, name: String, modifier: Modifier = Modifier, size: Dp = 16.dp) {
    IconFile(LocalProjectIconPath.current(id), modifier.size(size), RoundedCornerShape(size * 0.3f)) {
        ProjectBadge(name, modifier, size)
    }
}

/**
 * A saved icon file, or [fallback] when there is none or it won't decode: Coil reads PNG, JPEG,
 * WebP and ICO here but has no SVG decoder, so an SVG icon shows the fallback.
 */
@Composable
private fun IconFile(path: String?, modifier: Modifier, shape: RoundedCornerShape, fallback: @Composable () -> Unit) {
    var broken by remember { mutableStateOf<String?>(null) }
    if (path == null || path == broken || path.endsWith(".svg")) return fallback()
    AsyncImage(
        model = File(path),
        contentDescription = null,
        modifier = modifier.clip(shape),
        contentScale = ContentScale.Fit,
        onError = { broken = path },
    )
}
