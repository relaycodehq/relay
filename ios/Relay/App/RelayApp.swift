import RelayRemote
import SwiftUI

@main
struct RelayApp: App {
    @State private var connection = Connection()
    @State private var readAloud = ReadAloud()
    @State private var icons = ProjectIconStore()
    @State private var incoming: IncomingPair?
    @Environment(\.scenePhase) private var phase

    var body: some Scene {
        WindowGroup {
            SplashHost { RootView(incoming: $incoming) }
                // Inside the environment: the theme reads the desktop's appearance.
                .relayTheme()
                .environment(connection)
                .environment(readAloud)
                .environment(icons)
                .onOpenURL { url in incoming = parsePairingURL(url.absoluteString).map(IncomingPair.init) }
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
                if next == .new { stacks[tab]?.routes.append(.newThread()) } else { tab = next }
            })
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
            .environment(\.threadFilter, filter.wrappedValue)
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

    func body(content: Content) -> some View {
        content
            .navigationTitle(tab.title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar(removing: .title)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    TabTitle(title: tab.title, subtitle: tab == .settings ? nil : connection.statusLine)
                }
                .sharedBackgroundVisibility(.hidden)
                actions
            }
    }
}

/// A tab's title in the navigation bar, as large as the title row it stands in for.
private struct TabTitle: View {
    let title: String
    let subtitle: String?
    @Environment(\.colors) private var colors

    var body: some View {
        // As Photos: the title centred on the bar's buttons, the subtitle hanging below that row.
        Text(title)
            .font(.largeTitle.bold())
            .foregroundStyle(colors.foreground)
            .overlay(alignment: .bottomLeading) {
                if let subtitle, !subtitle.isEmpty {
                    Text(subtitle)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(colors.muted)
                        .fixedSize()
                        .frame(height: 0, alignment: .top)
                }
            }
            .lineLimit(1)
            .fixedSize()
            .accessibilityElement(children: .combine)
            .accessibilityAddTraits(.isHeader)
    }
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
