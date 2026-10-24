package dev.relay.android.features.home

import androidx.activity.compose.PredictiveBackHandler
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.ExperimentalSharedTransitionApi
import androidx.compose.animation.SharedTransitionLayout
import androidx.compose.animation.SharedTransitionScope
import androidx.compose.animation.SizeTransform
import androidx.compose.animation.core.SeekableTransitionState
import androidx.compose.animation.core.rememberTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.relay.android.remote.Remote
import dev.relay.android.remote.credentials.ComputerSeen
import dev.relay.android.remote.model.RemoteOverview
import dev.relay.android.ui.ButtonSize
import dev.relay.android.ui.IconButton
import dev.relay.android.ui.Text
import dev.relay.android.ui.theme.RelayTheme
import io.github.lyxnx.compose.ui.tablericons.TablerIcons
import io.github.lyxnx.compose.ui.tablericons.outline.ArrowLeft
import io.github.lyxnx.compose.ui.tablericons.outline.Search
import io.github.lyxnx.compose.ui.tablericons.outline.X
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

/** A tab's title, large as the iPhone's. */
@Composable
internal fun tabTitleStyle(): TextStyle =
    RelayTheme.type.base.copy(fontSize = 30.sp, lineHeight = 36.sp, fontWeight = FontWeight.Bold, letterSpacing = (-0.5).sp)

/** What the search in the header looks for, and whether it's open. */
internal class HomeSearch(val open: Boolean, val query: String, val onOpen: (Boolean) -> Unit, val onQuery: (String) -> Unit)

private const val SEARCH_BOX = "home-search"

/**
 * The tab's title with the computer under it, and filter and search in a capsule beside them.
 * Search stretches the capsule into the bar (Material's container transform), and a back swipe
 * shrinks it home as the finger moves.
 */
@OptIn(ExperimentalSharedTransitionApi::class)
@Composable
internal fun HomeHeader(
    tab: HomeTab,
    remote: Remote,
    seen: ComputerSeen,
    overview: RemoteOverview?,
    filter: ThreadFilter,
    onFilter: (ThreadFilter) -> Unit,
    search: HomeSearch,
    computerRows: @Composable (close: () -> Unit) -> Unit,
) {
    val state = remember { SeekableTransitionState(search.open) }
    LaunchedEffect(search.open) { state.animateTo(search.open) }
    val scope = rememberCoroutineScope()
    PredictiveBackHandler(enabled = search.open) { swipe ->
        try {
            swipe.collect { state.seekTo(it.progress, targetState = false) }
            search.onOpen(false)
        } catch (e: CancellationException) {
            scope.launch { state.animateTo(true) }
            throw e
        }
    }
    val transition = rememberTransition(state)
    SharedTransitionLayout {
        transition.AnimatedContent(
            transitionSpec = { fadeIn(tween(200, delayMillis = 80)) togetherWith fadeOut(tween(100)) using SizeTransform(clip = false) },
        ) { open ->
            val box = Modifier.sharedBounds(
                rememberSharedContentState(SEARCH_BOX),
                this,
                resizeMode = SharedTransitionScope.ResizeMode.RemeasureToBounds,
                clipInOverlayDuringTransition = OverlayClip(CircleShape),
            )
            if (open) SearchBar(search, box)
            else TitleRow(tab, remote, seen, overview, filter, onFilter, { search.onOpen(true) }, box, computerRows)
        }
    }
}

@Composable
private fun TitleRow(
    tab: HomeTab,
    remote: Remote,
    seen: ComputerSeen,
    overview: RemoteOverview?,
    filter: ThreadFilter,
    onFilter: (ThreadFilter) -> Unit,
    onSearch: () -> Unit,
    box: Modifier,
    computerRows: @Composable (close: () -> Unit) -> Unit,
) {
    val c = RelayTheme.colors
    Row(
        Modifier.fillMaxWidth().padding(start = 20.dp, end = 12.dp, top = 12.dp, bottom = 10.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.Top,
    ) {
        if (tab == HomeTab.Settings) {
            Text("Settings", Modifier.weight(1f), style = tabTitleStyle(), maxLines = 1)
            return@Row
        }
        ComputerSwitch(if (tab == HomeTab.Activity) "Threads" else "Projects", remote, seen, Modifier.weight(1f), computerRows)
        Row(
            Modifier.padding(top = 2.dp).then(box).height(52.dp).background(c.popover, CircleShape).border(1.dp, c.border, CircleShape)
                .padding(horizontal = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (tab == HomeTab.Activity && overview != null) FilterButton(overview, filter, onFilter)
            IconButton(TablerIcons.Outline.Search, "Search", onSearch, size = ButtonSize.Lg, tint = c.foreground)
        }
    }
}

/** The capsule stretched across: back on the left, what's typed, and a clear that closes once empty. */
@Composable
private fun SearchBar(search: HomeSearch, box: Modifier) {
    val c = RelayTheme.colors
    val focus = remember { FocusRequester() }
    LaunchedEffect(Unit) { focus.requestFocus() }
    val text = RelayTheme.type.base.copy(fontSize = 16.sp, color = c.foreground)
    Row(
        Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 10.dp).then(box).height(52.dp)
            .background(c.popover, CircleShape).border(1.dp, c.border, CircleShape).padding(horizontal = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        IconButton(TablerIcons.Outline.ArrowLeft, "Close search", { search.onOpen(false) }, tint = c.foreground)
        Box(Modifier.weight(1f).padding(horizontal = 4.dp)) {
            if (search.query.isEmpty()) Text("Search threads and projects", style = text, color = c.faint, maxLines = 1)
            BasicTextField(
                search.query,
                search.onQuery,
                Modifier.fillMaxWidth().focusRequester(focus),
                textStyle = text,
                singleLine = true,
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                cursorBrush = SolidColor(c.foreground),
            )
        }
        val empty = search.query.isEmpty()
        IconButton(
            TablerIcons.Outline.X,
            if (empty) "Close search" else "Clear",
            { if (empty) search.onOpen(false) else search.onQuery("") },
            tint = c.mutedForeground,
        )
    }
}
