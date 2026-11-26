package dev.relay.android.shots

import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.test.onRoot
import com.github.takahirom.roborazzi.captureRoboImage
import dev.relay.android.app.PaneEmpty
import dev.relay.android.features.home.ActivityList
import dev.relay.android.features.home.ComputerNameLine
import dev.relay.android.features.home.FilterButton
import dev.relay.android.features.home.HomeComposer
import dev.relay.android.features.home.HomeDock
import dev.relay.android.features.home.HomeHeader
import dev.relay.android.features.home.HomeShell
import dev.relay.android.features.home.HomeTab
import dev.relay.android.features.home.ProjectsList
import dev.relay.android.features.home.ThreadFilter
import dev.relay.android.features.pulls.ListedPull
import dev.relay.android.features.pulls.Relation
import dev.relay.android.features.search.SearchFrame
import dev.relay.android.features.search.SearchResults
import dev.relay.android.features.search.pullResults
import dev.relay.android.features.search.search
import dev.relay.android.remote.model.HostUser
import dev.relay.android.remote.model.IssueHit
import dev.relay.android.remote.model.IssueRepo
import dev.relay.android.remote.model.PullMerged
import dev.relay.android.remote.model.RemoteChatSummary
import dev.relay.android.remote.model.RemoteOverview
import dev.relay.android.remote.model.RemoteProject
import dev.relay.android.ui.CircleButton
import dev.relay.android.ui.CircleTone
import dev.relay.android.ui.EmptyGreeting
import dev.relay.android.ui.LocalPaneToggle
import dev.relay.android.ui.LocalToasts
import dev.relay.android.ui.Text
import dev.relay.android.ui.ToastState
import dev.relay.android.ui.theme.RelayPaperLight
import dev.relay.android.ui.theme.RelayTheme
import io.github.lyxnx.compose.ui.tablericons.TablerIcons
import io.github.lyxnx.compose.ui.tablericons.outline.LayoutSidebar
import androidx.compose.ui.platform.LocalView
import androidx.core.graphics.Insets
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.swipeUp
import dev.relay.android.ui.theme.RelayPaperDark
import org.junit.Test
import org.robolectric.RuntimeEnvironment
import androidx.compose.runtime.remember
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.snapshots.Snapshot

/** The shell: home under its header and dock, search, and the strips that show them moving. */
class ShellShots : ShotTest() {
    private val minute = 60_000L
    private val now = System.currentTimeMillis()

    private val projects = listOf(
        RemoteProject("relay", "relay"), RemoteProject("web", "website"), RemoteProject("anyfin", "Anyfin", folder = "Apps"),
        RemoteProject("planner", "Planner"), RemoteProject("scratch", "Scratchpad", scratch = true),
    )

    private val titles = listOf(
        "Redesign the Android app" to "relay", "Why does the composer jump on rotate?" to "relay", "Compare page copy" to "web",
        "Bump Compose to 1.13" to "relay", "Explanation of the turn lifecycle rewrite, with every replay and the recording format" to "relay",
        "Plan the release notes" to "relay", "Subtitle picker for the TV app" to "anyfin", "Old pricing table" to "web",
        "Implant the crash reporter into headless" to "relay", "Weekly planning" to "planner", "Frosted glass on Windows" to "relay",
        "Hero animation stutters" to "web", "Search across messages" to "relay", "Keep awake on battery" to "relay", "Voice dictation quirks" to "relay",
    )

    private val chats = titles.mapIndexed { i, (title, project) ->
        val at = now - minute * longArrayOf(1, 7, 22, 48, 95, 240, 600, 1500, 3000, 6000, 12000, 18000, 26000, 60000, 90000)[i]
        RemoteChatSummary(
            "$i", project, title, scope = "project", updated = at, created = at, provider = "claude",
            running = if (i == 0) true else null, waiting = if (i == 1) true else null,
            runningSince = at, markedUnread = if (i == 3 || i == 5) true else null, seenAt = now,
            pinnedAt = if (i == 5 || i == 6) at else null, settledAt = if (i == 7) at else null,
        )
    }

    @Composable
    private fun Home(tab: HomeTab, empty: Boolean = false, pane: Boolean = false, selected: String? = null, onTab: (HomeTab) -> Unit = {}, name: String = "MacBook Pro") {
        CompositionLocalProvider(
            LocalToasts provides remember { ToastState() },
        ) {
            HomeShell(
                tab,
                pane = pane,
                header = {
                    HomeHeader(
                        tab, {}, {},
                        computer = { ComputerNameLine(name, RelayTheme.type.body.copy(fontWeight = FontWeight.Medium), {}, color = RelayTheme.colors.inkSoft) },
                        hasFilter = tab == HomeTab.Threads,
                        filter = { FilterButton(RemoteOverview("m", projects = projects, chats = chats), ThreadFilter(), {}) },
                    )
                },
                dock = { dockModifier, onHeight ->
                    HomeDock(tab, onTab, followsKeyboard = !pane, threadsNews = tab != HomeTab.Threads, onHeight = onHeight, modifier = dockModifier, hasComposer = tab == HomeTab.Threads) { HomeComposer({}) }
                },
            ) { shown, bottom ->
                when {
                    empty -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { EmptyGreeting() }
                    shown == HomeTab.Threads -> ActivityList(
                        chats, projects, emptyMap(), false, { it.markedUnread == true }, emptyMap(), { _, _ -> },
                        Int.MAX_VALUE, selected, {}, { _, _ -> }, { _, _ -> null }, bottom,
                    )
                    shown == HomeTab.Projects -> ProjectsList(RemoteOverview("m", projects = projects, chats = chats), emptyMap(), null, {}, {}, {}, bottom)
                    else -> LazyColumn { items(20) { Text("Pull request $it") } }
                }
            }
        }
    }

    @Composable
    private fun Search(query: String, list: List<RemoteChatSummary> = chats, pulls: Boolean = false) {
        SearchFrame(query, {}, "Search threads and projects", null, {}) {
            SearchResults(
                query, search(query, list, projects), now, {}, {}, 16.dp,
                onSearchPulls = if (pulls) null else ({}),
                pulls = if (!pulls) null else ({ terms -> pullResults(terms, samplePulls, "open", {}, null, now) {} }),
            )
        }
    }

    private val samplePulls = listOf("Plan mode for the phone", "Replant the sidebar").mapIndexed { i, title ->
        ListedPull(
            IssueHit(40 + i, title, "open", user = HostUser(login = "lena"), repository = IssueRepo(owner = "acme", name = "relay"), pull_request = PullMerged(), updated_at = "2026-11-2${i}T10:00:00Z"),
            "https://github.com", Relation.Review,
        )
    }

    @Test
    fun bar() {
        for (tab in HomeTab.entries) {
            Shot("bar-${tab.name}") { Home(tab) }
            Shot("bar-desk-${tab.name}") { Desk { Home(tab) } }
        }
        Shot("bar-dark", dark = true) { Home(HomeTab.Threads) }
        Shot("bar-large") { LargeText { Home(HomeTab.Projects) } }
        Shot("bar-narrow") { Box(Modifier.width(240.dp)) { Home(HomeTab.Pulls) } }
    }

    @Test
    fun home() {
        for (dark in listOf(false, true)) {
            Shot("shell-home", dark = dark) { Home(HomeTab.Threads) }
            Shot("shell-projects", dark = dark) { Home(HomeTab.Projects) }
            Shot("shell-empty", dark = dark) { Home(HomeTab.Threads, empty = true) }
            Shot("shell-wide", ShotDevice.FoldInner, dark) { Wide() }
        }
        // Unfolded with the sidebar hidden: the list fills the screen, and the dock lines up with it.
        Shot("shell-home-unfolded", ShotDevice.FoldInner) { Home(HomeTab.Threads) }
        Shot("shell-home-large") { LargeText { Home(HomeTab.Threads, name = "lubomirs-very-long-workstation.local") } }
    }

    @Composable
    private fun Wide() {
        Row(Modifier.fillMaxSize().background(RelayTheme.colors.chrome)) {
            Box(Modifier.width(320.dp).fillMaxHeight()) { Home(HomeTab.Threads, pane = true) }
            val toggle: @Composable () -> Unit = { CircleButton(TablerIcons.Outline.LayoutSidebar, "Hide list", {}, tone = CircleTone.Raised) }
            CompositionLocalProvider(LocalPaneToggle provides toggle) { Box(Modifier.weight(1f).padding(start = 8.dp)) { PaneEmpty() } }
        }
    }

    @Composable
    private fun LargeText(content: @Composable () -> Unit) {
        val density = LocalDensity.current
        CompositionLocalProvider(LocalDensity provides Density(density.density, 1.3f), content = content)
    }

    /** On the desktop's palette, over Android's three buttons (48dp). */
    @Test
    fun desktopPalette() {
        Shot("shell-desk-home") { Desk { Home(HomeTab.Threads) } }
        Shot("shell-desk-projects") { Desk { Home(HomeTab.Projects) } }
        Shot("shell-desk-search") { Desk { Search("plan") } }
        Shot("shell-desk-wide", ShotDevice.FoldInner) { Desk { Wide() } }
    }

    /** The long list in the middle and at its end: nothing shows through the dock, the last row clears it. */
    @Test
    fun scrolled() {
        val up = { compose.onRoot().performTouchInput { swipeUp(durationMillis = 400) } }
        for ((name, palette) in listOf("light" to RelayPaperLight, "dark" to RelayPaperDark, "desk" to desktopDark)) {
            for (end in listOf(false, true)) Shot("shell-scrolled-$name-${if (end) "end" else "middle"}", act = { if (end) repeat(4) { up() } else compose.onRoot().performTouchInput { swipeUp(startY = 1900f, endY = 1400f, durationMillis = 400) } }) {
                RelayTheme(palette) { Box(Modifier.fillMaxSize().background(RelayTheme.colors.surface)) { Home(HomeTab.Threads) } }
            }
        }
    }

    @Composable
    private fun Desk(content: @Composable () -> Unit) {
        val view = LocalView.current
        LaunchedEffect(Unit) {
            ViewCompat.dispatchApplyWindowInsets(
                view.rootView,
                WindowInsetsCompat.Builder()
                    .setInsets(WindowInsetsCompat.Type.statusBars(), Insets.of(0, 90, 0, 0))
                    .setInsets(WindowInsetsCompat.Type.navigationBars(), Insets.of(0, 0, 0, 144))
                    .build(),
            )
        }
        RelayTheme(desktopDark, content)
    }

    @Test
    fun search() {
        for (dark in listOf(false, true)) {
            Shot("shell-search", dark = dark) { Search("plan") }
            Shot("shell-search-all", dark = dark) { Search("") }
        }
        Shot("shell-search-web") { Search("web") }
        Shot("shell-search-none") { Search("zebra crossing") }
        Shot("shell-search-pulls") { Search("plan", pulls = true) }
        Shot("shell-search-large") { LargeText { Search("plan rel") } }
        Shot("shell-search", ShotDevice.FoldInner) { Search("plan") }
    }

    /** [content] as it is, then frames 33ms apart after [act], to look at how something moves. */
    private fun strip(name: String, frames: Int, act: () -> Unit, content: @Composable () -> Unit) {
        RuntimeEnvironment.setQualifiers("${ShotDevice.Phone.size}-notnight-mdpi")
        compose.mainClock.autoAdvance = false
        compose.activity.setContent { RelayTheme(RelayPaperLight) { Box(Modifier.fillMaxSize()) { content() } } }
        Snapshot.sendApplyNotifications()
        compose.mainClock.advanceTimeBy(1_000)
        // Nothing is measured until it's first drawn, and what never was has nothing to animate from.
        frame(name, 0)
        compose.mainClock.advanceTimeBy(500)
        act()
        Snapshot.sendApplyNotifications()
        frames(name, 1, frames)
    }

    private fun frames(name: String, from: Int, count: Int) = repeat(count) { i ->
        compose.mainClock.advanceTimeBy(33)
        frame(name, from + i)
    }

    private fun frame(name: String, number: Int) {
        val dir = System.getProperty("relay.shots.dir") ?: "build/shots"
        compose.onRoot().captureRoboImage("$dir/strip-$name/${"%02d".format(number)}.png")
    }

    @Test
    fun stripTabs() {
        var tab by mutableStateOf(HomeTab.Threads)
        strip("tabs", 18, { tab = HomeTab.Projects }) { Home(tab) }
        tab = HomeTab.Pulls
        Snapshot.sendApplyNotifications()
        frames("tabs", 19, 18)
        tab = HomeTab.Threads
        Snapshot.sendApplyNotifications()
        frames("tabs", 37, 18)
    }

    @Test
    fun stripSearch() {
        var query by mutableStateOf("")
        strip("search", 14, { query = "plan" }) { Search(query) }
    }
}
