import SwiftUI

/// What's searched on the Threads tab. Held by the tabs for iOS 26.0's own field, which is laid
/// over the tab's stack; nothing above reads it, so typing redraws the list alone.
@Observable final class ThreadSearchState {
    var query = ""
    var open = false

    func close() {
        open = false
        query = ""
    }

    /// iOS 26.0 ignores `.minimize` in the top bar and docks a full field under the title, and a
    /// `.searchable` added only while open rebuilds the bar mid-animation (a black band, the title
    /// sliding in, the button's glass left behind). There the bar stays as it is and a field of
    /// our own fades in over it.
    static var minimizes: Bool {
        if #available(iOS 26.1, *) { true } else { false }
    }
}

extension View {
    /// The system's own search: a button in the bar that opens into its field.
    func threadSearch(_ search: ThreadSearchState) -> some View {
        modifier(SystemSearch(search: search))
    }

    /// iOS 26.0's search field over the tab's bar while it's open and the list is showing.
    func threadSearchCover(_ search: ThreadSearchState, stack: StackPath) -> some View {
        overlay(alignment: .top) {
            if !ThreadSearchState.minimizes { SearchCover(search: search, stack: stack) }
        }
    }
}

private struct SystemSearch: ViewModifier {
    @Bindable var search: ThreadSearchState

    func body(content: Content) -> some View {
        if ThreadSearchState.minimizes {
            content
                .searchable(text: $search.query, isPresented: $search.open, prompt: "Threads and projects")
                .searchToolbarBehavior(.minimize)
                .onSearchClosed { search.close() }
        } else {
            content
        }
    }
}

private struct SearchCover: View {
    @Bindable var search: ThreadSearchState
    let stack: StackPath
    @Environment(\.colors) private var colors

    var body: some View {
        ZStack(alignment: .top) {
            if search.open && stack.routes.isEmpty {
                OwnSearchField(query: $search.query) { search.close() }
                    .padding(.top, 5)
                    // Down past the computer's name, which hangs below the bar.
                    .padding(.bottom, 32)
                    .background {
                        colors.background
                            .mask(LinearGradient(stops: [.init(color: .black, location: 0.85), .init(color: .clear, location: 1)], startPoint: .top, endPoint: .bottom))
                            .ignoresSafeArea(edges: .top)
                    }
                    .transition(.opacity)
            }
        }
        .animation(.easeOut(duration: 0.18), value: search.open)
    }
}

/// The bar's search field drawn by hand, as close to the system's as it goes.
private struct OwnSearchField: View {
    @Binding var query: String
    let close: () -> Void
    @FocusState private var focused: Bool

    var body: some View {
        HStack(spacing: 10) {
            HStack(spacing: 6) {
                Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
                TextField("Threads and projects", text: $query)
                    .focused($focused)
                    .submitLabel(.search)
                    .autocorrectionDisabled()
                if !query.isEmpty {
                    Button("Clear text", systemImage: "xmark.circle.fill") { query = "" }
                        .labelStyle(.iconOnly)
                        .buttonStyle(.plain)
                        .foregroundStyle(.secondary)
                }
            }
            .padding(.horizontal, 14)
            .frame(height: 44)
            .glassEffect(.regular.interactive(), in: .capsule)
            Button(action: close) {
                Image(systemName: "xmark")
                    .font(.system(size: 17, weight: .medium))
                    .frame(width: 44, height: 44)
                    .contentShape(.circle)
            }
            .buttonStyle(.plain)
            .glassEffect(.regular.interactive(), in: .circle)
            .accessibilityLabel("Close")
        }
        .padding(.horizontal, 16)
        // Back from a thread opened from the results, the keyboard stays down.
        .onAppear { if query.isEmpty { focused = true } }
    }
}
