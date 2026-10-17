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
    @State private var tab = HomeTab.threads
    @State private var query = ""
    @AppStorage("relay.thread-filter") private var filterData = Data()

    private var filter: Binding<ThreadFilter> {
        Binding(
            get: { (try? JSONDecoder().decode(ThreadFilter.self, from: filterData)) ?? ThreadFilter() },
            set: { filterData = (try? JSONEncoder().encode($0)) ?? Data() })
    }

    var body: some View {
        if connection.paired {
            // A stack per tab, as iOS means tabs to be: the search tab's circle turns into the
            // bar's search field only then. Each stack drops the tab bar as it pushes.
            TabView(selection: $tab) {
                Tab("Threads", systemImage: "bubble.left.and.bubble.right", value: .threads) {
                    RouteStack { open in
                        HomeView().tabChrome(.threads) {
                            ToolbarItem(placement: .primaryAction) {
                                FilterMenu(filter: filter).badge(connection.current(filter.wrappedValue).count)
                            }
                            ToolbarSpacer(.fixed, placement: .primaryAction)
                            ToolbarItem(placement: .primaryAction) { NewButton { open(.newThread()) } }
                        }
                    }
                }
                Tab("Projects", systemImage: "square.grid.2x2", value: .projects) {
                    RouteStack { open in
                        ProjectsHome().tabChrome(.projects) {
                            ToolbarItem(placement: .primaryAction) { NewButton { open(.newThread()) } }
                        }
                    }
                }
                Tab("Settings", systemImage: "gearshape", value: .settings) {
                    RouteStack { _ in SettingsView().tabChrome(.settings) }
                }
                // A circle apart from the tabs, turning into the search field when picked. On the
                // TabView, the search would reach every tab's bar.
                Tab(value: .search, role: .search) {
                    RouteStack { _ in
                        SearchTab(query: query)
                            .tabChrome(.search)
                            .searchable(text: $query, prompt: "Threads and projects")
                    }
                }
            }
            .tabViewSearchActivation(.searchTabSelection)
            .environment(\.threadFilter, filter.wrappedValue)
            .sheet(item: $incoming) { _ in
                PairingView(incoming: $incoming)
            }
            .task(id: IconWant(connection)) {
                icons.prune(keeping: Set(connection.computers.map(\.key)))
                guard connection.status.state == .online else { return }
                await icons.keep(connection, projectIds: connection.overview?.projects.map(\.id) ?? [])
            }
        } else {
            PairingView(incoming: $incoming)
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

/// Starts a thread; "New" beside its icon, to fill the bar as Photos' Select does.
private struct NewButton: View {
    let action: () -> Void
    @Environment(Connection.self) private var connection

    var body: some View {
        // Its own label: a toolbar shows a Label's icon alone.
        Button(action: action) {
            HStack(spacing: 6) {
                Image(systemName: "square.and.pencil")
                Text("New")
            }
        }
        .accessibilityLabel("New thread")
        .disabled(connection.status.state != .online)
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

enum HomeTab: Hashable {
    case threads, projects, settings, search

    var title: String {
        switch self {
        case .threads: "Threads"
        case .projects: "Projects"
        case .settings: "Settings"
        case .search: "Search"
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
