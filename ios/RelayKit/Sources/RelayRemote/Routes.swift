import Foundation

public enum RouteKind: String, Codable, Sendable, CaseIterable {
    case local
    case tailscale
}

/// `shared/remote-routes.ts`.
public enum Routes {
    /// Local network first: when both answer, it's the shorter way.
    public static let defaultOrder: [RouteKind] = [.local, .tailscale]
    public static let maxHosts = 8

    public static func kind(_ host: String) -> RouteKind {
        var bare = host.lowercased()
        if bare.hasPrefix("[") { bare.removeFirst() }
        if bare.hasSuffix("]") { bare.removeLast() }
        let parts = bare.split(separator: ".", omittingEmptySubsequences: false).map(String.init)
        let a = jsNumber(parts[0])
        let b = parts.count > 1 ? jsNumber(parts[1]) : .nan
        if a == 100, b >= 64, b <= 127 { return .tailscale }
        if bare.hasPrefix("fd7a:115c:a1e0:") || bare.hasSuffix(".ts.net") { return .tailscale }
        return .local
    }

    /// The hosts by route, in the order given; within a route, as they came.
    public static func order(_ hosts: [String], routes: [RouteKind] = defaultOrder) -> [String] {
        func rank(_ host: String) -> Int { routes.firstIndex(of: kind(host)) ?? routes.count }
        return hosts.enumerated()
            .sorted { (rank($0.element), $0.offset) < (rank($1.element), $1.offset) }
            .map(\.element)
    }

    /// The hosts the desktop named, plus the one the phone came in by.
    public static func learn(_ fresh: [String], via: String) -> [String] {
        var seen = Set<String>()
        return (fresh.prefix(maxHosts - 1) + [via]).filter { seen.insert($0).inserted }
    }
}
