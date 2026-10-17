import RelayRemote
import SwiftUI

@main
struct RelayApp: App {
    @State private var connection = Connection()
    @State private var readAloud = ReadAloud()
    @State private var icons = ProjectIconStore()
    @State private var updates = ComputerUpdates()
    @State private var incoming: IncomingPair?
    /// A thread a relay-native://chat link asked for.
    @State private var linked: LinkedThread?
    @Environment(\.scenePhase) private var phase

    var body: some Scene {
        WindowGroup {
            SplashHost { RootView(incoming: $incoming, linked: $linked) }
                // Inside the environment: the theme reads the desktop's appearance.
                .relayTheme()
                .environment(connection)
                .environment(readAloud)
                .environment(icons)
                .environment(updates)
                .onOpenURL { url in
                    switch parseDeepLink(url.absoluteString) {
                    case .pair(let link): incoming = IncomingPair(link: link)
                    case .thread(let id): linked = LinkedThread(chatId: id)
                    case nil: break
                    }
                }
                .task { connection.launch() }
                .onChange(of: phase) { _, now in
                    if now == .active { connection.wake() }
                }
                .onChange(of: connection.active) { readAloud.stop() }
        }
    }
}

struct RootView: View {
    @Environment(Connection.self) private var connection
    @Environment(ProjectIconStore.self) private var icons
    @Binding var incoming: IncomingPair?
    /// A first pairing keeps its screen up until Continue, past the moment the computer says yes.
    @State private var pairing = false
    @Binding var linked: LinkedThread?
    @State private var tab = HomeTab.threads
    @Environment(\.colors) private var colors
    /// Each tab's own: a push redraws that tab's stack, not the root and every tab under it.
    @State private var stacks = Dictionary(uniqueKeysWithValues: HomeTab.allCases.map { ($0, StackPath()) })
    @AppStorage("relay.thread-filter") private var filterData = Data()

    /// The tab bar's picks, New among them: it opens a new thread on the tab showing rather
    /// than being a tab of its own.
    private var picked: Binding<HomeTab> {
        Binding(
            get: { tab },
            set: { next in
                guard next == .new else { return tab = next }
                stacks[tab]?.routes.append(.newThread())
                // UIKit took the circle for picked all the same; left so, the next tap on it
                // would show its empty page.
                if let index = HomeTab.allCases.firstIndex(of: tab) {
                    DispatchQueue.main.async { keepTabSelected(index) }
                }
            })
    }

    /// The thread on screen, which needs no telling about.
    private var openThread: String? {
        switch stacks[tab]?.routes.last {
        case .thread(let id)?, .replies(let id, _)?: id
        default: nil
        }
    }

    private var filter: Binding<ThreadFilter> {
        Binding(
            get: { (try? JSONDecoder().decode(ThreadFilter.self, from: filterData)) ?? ThreadFilter() },
            set: { filterData = (try? JSONEncoder().encode($0)) ?? Data() })
    }

    var body: some View {
        if connection.paired && !pairing {
            // A stack per tab, as iOS means tabs to be: the search tab's circle turns into the
            // bar's search field only then. Each stack drops the tab bar as it pushes.
            TabView(selection: picked) {
                Tab(value: HomeTab.threads) {
                    RouteStack(stack: stacks[.threads]!) { _ in ThreadsHome(filter: filter) }
                } label: {
                    Label { Text("Threads") } icon: { TabIcon.threads.image(picked: tab == .threads, accent: colors.accent, ink: colors.foreground) }
                }
                Tab(value: HomeTab.projects) {
                    RouteStack(stack: stacks[.projects]!) { _ in ProjectsHome().tabChrome(.projects) }
                } label: {
                    Label { Text("Projects") } icon: { TabIcon.projects.image(picked: tab == .projects, accent: colors.accent, ink: colors.foreground) }
                }
                Tab(value: HomeTab.settings) {
                    RouteStack(stack: stacks[.settings]!) { _ in SettingsView().tabChrome(.settings) }
                } label: {
                    Label { Text("Settings") } icon: { TabIcon.settings.image(picked: tab == .settings, accent: colors.accent, ink: colors.foreground) }
                }
                // New, where a thumb reaches it: the bar sets a search tab's circle apart from the
                // tabs, the place Photos keeps search, and there's no other way to have one.
                Tab("New thread", systemImage: "square.and.pencil", value: HomeTab.new, role: .search) {
                    Color.clear.searchable(text: .constant(""))
                }
            }
            .tabViewSearchActivation(.searchTabSelection)
            .hotReloads()
            .environment(\.threadFilter, filter.wrappedValue)
            .overlay(alignment: .top) {
                NeedsYou(stack: stacks[tab]!, atList: tab == .threads) { stacks[tab]?.routes.append(.thread($0)) }
            }
            .threadNotices(openId: openThread, hidden: tab == .threads && stacks[.threads]!.routes.isEmpty) {
                stacks[tab]?.routes.append(.thread($0))
            }
            // Whatever was open belongs to the computer being left.
            .onChange(of: connection.active) {
                for stack in stacks.values { stack.routes = [] }
            }
            .onChange(of: linked?.id, initial: true) {
                guard let linked else { return }
                self.linked = nil
                tab = .threads
                stacks[.threads]?.routes = [.thread(linked.chatId)]
            }
            .fullScreenCover(item: $incoming) { _ in
                PairingView(incoming: $incoming, holding: .constant(false))
            }
            .task(id: IconWant(connection)) {
                icons.prune(keeping: Set(connection.computers.map(\.key)))
                guard connection.status.state == .online else { return }
                await icons.keep(connection, projectIds: connection.overview?.projects.map(\.id) ?? [])
            }
        } else {
            PairingView(incoming: $incoming, holding: $pairing)
        }
    }
}

/// The Threads tab's root, holding what's searched: held above the tabs, every letter typed
/// redrew them all.
private struct ThreadsHome: View {
    @Binding var filter: ThreadFilter
    @State private var query = ""
    @State private var searching = false
    @Environment(Connection.self) private var connection

    var body: some View {
        HomeView(query: query).tabChrome(.threads) {
            ToolbarItem(placement: .primaryAction) {
                FilterMenu(filter: $filter).badge(connection.current(filter).count)
            }
        }
        // The system's own search: a button in the bar that opens into its field.
        .searchable(text: $query, isPresented: $searching, prompt: "Threads and projects")
        .searchToolbarBehavior(.minimize)
        .onSearchClosed {
            searching = false
            query = ""
        }
    }
}

extension View {
    /// A tab's bar: its title in the bar's own row, beside `actions`, rather than in a row below.
    func tabChrome(_ tab: HomeTab, @ToolbarContentBuilder actions: () -> some ToolbarContent) -> some View {
        modifier(TabChrome(tab: tab, actions: actions()))
    }

    func tabChrome(_ tab: HomeTab) -> some View {
        tabChrome(tab) { ToolbarItemGroup(placement: .primaryAction) {} }
    }
}

private struct TabChrome<Actions: ToolbarContent>: ViewModifier {
    let tab: HomeTab
    let actions: Actions
    @Environment(Connection.self) private var connection
    @Environment(NameSpot.self) private var name: NameSpot?

    func body(content: Content) -> some View {
        content
            .navigationTitle(tab.title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar(removing: .title)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    TabTitle(
                        title: tab.title, subtitle: tab == .settings ? nil : connection.statusLine, switches: tab != .settings,
                        name: name)
                }
                .sharedBackgroundVisibility(.hidden)
                actions
            }
            // The computer's name hangs below the bar: room for it, so the bar's soft edge
            // reaches past it as Photos' does past its count, instead of stopping at its middle.
            .safeAreaBar(edge: .top) { Color.clear.frame(height: tab == .settings ? 0 : 26) }
            .scrollEdgeEffectStyle(.soft, for: .top)
    }
}

/// The paired computers to switch to, pairing another and managing them, in a menu that grows
/// out of `label` as the filter's does. Unreached, it leads with why and what would help: the
/// tabs say no more than "offline" under the title.
struct ComputerMenu<Label: View>: View {
    @ViewBuilder let label: Label
    @Environment(Connection.self) private var connection
    @State private var pairing = false
    @State private var managing = false

    var body: some View {
        Menu {
            let lines = ComputerLines(
                computers: connection.computers, active: connection.active, status: connection.status,
                version: connection.overview?.version, reached: connection.reached, now: nowMs())
            Section {
                ForEach(connection.computers, id: \.key) { computer in
                    let here = computer.key == connection.active
                    Button {
                        if !here { connection.switchTo(computer.key) }
                    } label: {
                        Image(systemName: here ? "checkmark" : "desktopcomputer")
                        Text(computer.name)
                        // The title already says it's offline; when it was last there is what's left.
                        Text(here && connection.failing ? lines.lastReached(computer) : lines.hint(computer))
                    }
                }
                // The computer's row already says it can't be reached; this is what would help.
                switch trouble {
                case .tailnet:
                    Button { connection.wake() } label: {
                        Image(systemName: "arrow.clockwise")
                        Text("Try Now")
                        Text("Is Tailscale on here?")
                    }
                case .rescan:
                    Button("Scan Again", systemImage: "qrcode.viewfinder") { pairing = true }
                case nil:
                    EmptyView()
                }
            }
            Section {
                Button("Pair Another", systemImage: "plus") { pairing = true }
                Button("Manage", systemImage: "slider.horizontal.3") { managing = true }
            }
        } label: {
            label
        }
        .buttonStyle(.plain)
        .accessibilityHint("Switch computer")
        .sheet(isPresented: $managing) { ComputerSheet() }
        .fullScreenCover(isPresented: $pairing) { PairingView() }
    }

    private enum Trouble { case tailnet, rescan }

    /// What would help once the computer can't be reached: on Tailscale another try, since this
    /// phone can't see whether it's on; otherwise the code again, as the address may have moved.
    private var trouble: Trouble? {
        switch connection.status.state {
        case .online: return nil
        case .connecting where !connection.failing: return nil
        case .denied: return .rescan
        case .offline, .connecting:
            return connection.computer?.hosts.contains { Routes.kind($0) == .tailscale } == true ? .tailnet : .rescan
        }
    }
}

/// A tab's title in the navigation bar, as large as the title row it stands in for.
private struct TabTitle: View {
    let title: String
    let subtitle: String?
    /// Tapping it opens the computers to switch to; the screen lays the menu over it.
    var switches = false
    /// Where the title and the computer's name are drawn, for the menu the screen lays over them.
    var name: NameSpot?
    @Environment(\.colors) private var colors

    var body: some View {
        label
            .overlay(alignment: .bottomLeading) { hanging }
            .onGeometryChange(for: CGRect.self, of: { $0.frame(in: .global) }) { [name, switches] in
                if switches { name?.title = $0 }
            }
    }
    private var label: some View {
        Text(title)
            .font(.largeTitle.bold())
            .foregroundStyle(colors.foreground)
            .lineLimit(1)
            .fixedSize()
            .accessibilityAddTraits(.isHeader)
    }

    /// As Photos: the title centred on the bar's buttons, the subtitle hanging below that row.
    @ViewBuilder private var hanging: some View {
        if let subtitle, !subtitle.isEmpty {
            Text(switches ? "\(subtitle) \(Text(Image(systemName: "chevron.down")).font(.system(size: 9, weight: .bold)).baselineOffset(1))" : "\(subtitle)")
                .font(.footnote.weight(.semibold))
                .foregroundStyle(colors.muted)
                .lineLimit(1)
                .fixedSize()
                .onGeometryChange(for: CGRect.self, of: { $0.frame(in: .global) }) { [name, switches] in
                    if switches { name?.frame = $0 }
                }
                .frame(height: 0, alignment: .top)
        }
    }
}

/// Where a tab title and its computer name sit on screen. The bar takes no touches below
/// itself, where the name hangs, so the screen lays one menu over both and it grows from the title.
@Observable
final class NameSpot {
    var title: CGRect?
    var frame: CGRect?
}

enum HomeTab: Hashable, CaseIterable {
    case threads, projects, settings, new

    var title: String {
        switch self {
        case .threads: "Threads"
        case .projects: "Projects"
        case .settings: "Settings"
        case .new: "New thread"
        }
    }
}

/// A thread link opened from outside, once per opening.
struct LinkedThread: Identifiable {
    let id = UUID()
    let chatId: String
}

/// A pairing link opened from outside, once per opening: the same code
/// opened again after a failure tries again.
struct IncomingPair: Identifiable {
    let id = UUID()
    let link: PairingLink
}

/// What the project icons follow: the computer, whether it's reachable, and its projects.
private struct IconWant: Equatable {
    let computers: [String]
    let active: String?
    let online: Bool
    let projects: [String]

    init(_ connection: Connection) {
        computers = connection.computers.map(\.key)
        active = connection.active
        online = connection.status.state == .online
        projects = connection.overview?.projects.map(\.id) ?? []
    }
}
