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
            // One stack with the tabs at its root: a thread is pushed over the tab bar, which
            // drops away and follows a slow swipe back up, rather than being hidden and shown
            // again only once the swipe has finished.
            RouteStack { open in
                TabView(selection: $tab) {
                    Tab("Threads", systemImage: "bubble.left.and.bubble.right", value: .threads) { HomeView() }
                    Tab("Projects", systemImage: "square.grid.2x2", value: .projects) { ProjectsHome() }
                    Tab("Settings", systemImage: "gearshape", value: .settings) { SettingsView() }
                    // Apart from the tabs at the bar's end, turning into the search field when picked.
                    Tab(value: .search, role: .search) { SearchTab(query: $query) }
                }
                .environment(\.threadFilter, filter.wrappedValue)
                .background(TabBarDrop())
                // The tabs' bar is the stack's: what a tab's own view sets doesn't reach it.
                // The title sits in the bar's own row, beside its buttons, rather than in a row below.
                .navigationTitle(tab.title)
                .navigationBarTitleDisplayMode(.inline)
                .toolbar(removing: .title)
                .toolbar {
                    ToolbarItem(placement: .topBarLeading) {
                        TabTitle(title: tab.title, subtitle: tab == .settings ? nil : connection.statusLine)
                    }
                    .sharedBackgroundVisibility(.hidden)
                    if tab == .threads {
                        ToolbarItem(placement: .primaryAction) {
                            FilterMenu(filter: filter).badge(connection.current(filter.wrappedValue).count)
                        }
                        ToolbarSpacer(.fixed, placement: .primaryAction)
                    }
                    if tab == .threads || tab == .projects {
                        ToolbarItem(placement: .primaryAction) {
                            // Its own label: a toolbar shows a Label's icon alone.
                            Button { open(.newThread()) } label: {
                                HStack(spacing: 6) {
                                    Image(systemName: "square.and.pencil")
                                    Text("New")
                                }
                            }
                            .accessibilityLabel("New thread")
                            .disabled(connection.status.state != .online)
                        }
                    }
                }
            }
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
