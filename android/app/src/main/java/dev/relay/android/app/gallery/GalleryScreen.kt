package dev.relay.android.app.gallery

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import dev.relay.android.lib.navigation.LocalNavigator
import dev.relay.android.lib.navigation.backAction
import dev.relay.android.ui.Screen
import dev.relay.android.ui.SegmentedTabs
import dev.relay.android.ui.TabOption
import dev.relay.android.ui.Text
import dev.relay.android.ui.theme.HextaDark
import dev.relay.android.ui.theme.HextaLight
import dev.relay.android.ui.theme.RelayTheme

private enum class GalleryTheme { App, Light, Dark }

/** Every building block on sample data, in the app's theme or forced light/dark. */
@Composable
fun GalleryScreen() {
    val nav = LocalNavigator.current
    var theme by rememberSaveable { mutableStateOf(GalleryTheme.App) }
    Screen("Gallery", subtitle = "Sample data", onBack = nav.backAction) {
        SegmentedTabs(
            listOf(TabOption(GalleryTheme.App, "App"), TabOption(GalleryTheme.Light, "Light"), TabOption(GalleryTheme.Dark, "Dark")),
            theme,
            { theme = it },
            Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
        )
        val body: @Composable () -> Unit = {
            Column(
                Modifier.fillMaxSize().background(RelayTheme.colors.background).verticalScroll(rememberScrollState()).padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(28.dp),
            ) { GallerySections() }
        }
        when (theme) {
            GalleryTheme.App -> body()
            GalleryTheme.Light -> RelayTheme(HextaLight, body)
            GalleryTheme.Dark -> RelayTheme(HextaDark, body)
        }
    }
}

@Composable
internal fun Section(title: String, content: @Composable ColumnScope.() -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text(title, style = RelayTheme.type.caption, color = RelayTheme.colors.mutedForeground)
        content()
    }
}
