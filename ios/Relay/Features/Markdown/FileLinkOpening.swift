import RelayMarkdown
import RelayRemote
import SwiftUI

/// What pressing a link's destination (`inline` false) or a piece of inline code (`inline` true)
/// does, when it names something the app can open; nil leaves it as it is.
typealias OpenPath = (_ value: String, _ inline: Bool) -> (() -> Void)?

extension EnvironmentValues {
    /// Set around an answer: paths in its thread's folder open, and so does a localhost address
    /// in backticks while the computer tunnels.
    @Entry var openPath: OpenPath?
}

/// Inline code made a link carries what it says in one of these.
enum PathLink {
    private static let scheme = "relay-path"

    static func url(_ code: String) -> URL? {
        var parts = URLComponents()
        parts.scheme = scheme
        parts.host = "code"
        parts.queryItems = [URLQueryItem(name: "v", value: code)]
        return parts.url
    }

    static func code(in url: URL) -> String? {
        guard url.scheme == scheme else { return nil }
        return URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first { $0.name == "v" }?.value
    }
}

extension View {
    /// Paths an answer names open: a file its turn changed as that diff, any other file or a
    /// folder in the thread's folder in Files (Android's MessageView openPath).
    func openingFileLinks(chatId: String, message: ChatMessage, root: String?) -> some View {
        modifier(FileLinkOpening(chatId: chatId, message: message, root: root))
    }
}

private struct FileLinkOpening: ViewModifier {
    let chatId: String
    let message: ChatMessage
    let root: String?
    @Environment(Connection.self) private var connection
    @Environment(\.navigate) private var navigate

    func body(content: Content) -> some View {
        let place = connection.threads[chatId]?.bridgeWhere
        let tunnels = connection.canTunnel
        let changes = message.changes ?? []
        let messageId = message.id
        let navigate = navigate
        content.environment(\.openPath) { value, inline in
            if inline, tunnels, let site = LocalUrls.link(value) {
                return { navigate(.browser(url: site.href)) }
            }
            guard let root, let target = fileLinkTarget(value, inline: inline, root: root, changes: changes) else {
                return nil
            }
            switch target {
            case .diff(let change): return { navigate(.git(.diff(.turn(chatId: chatId, messageId: messageId, path: change.path)))) }
            case .file(let path): return place.map { place in { navigate(.file(place: place, path: path)) } }
            case .folder(let path): return place.map { place in { navigate(.files(place: place, dir: path)) } }
            }
        }
    }
}
