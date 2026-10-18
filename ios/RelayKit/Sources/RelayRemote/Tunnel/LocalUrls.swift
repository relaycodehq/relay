import Foundation

/// A place on the desktop's own loopback: its port, and the path with query and fragment.
public struct SiteAddress: Sendable, Hashable {
    public var port: Int
    public var path: String

    public init(port: Int, path: String = "/") {
        self.port = port
        self.path = path
    }

    /// As the address bar shows it.
    public var shown: String { "localhost:\(port)" + (path == "/" ? "" : path) }

    /// As the desktop's own browser has it.
    public var href: String { "http://localhost:\(port)\(path)" }
}

/// Links to the desktop's loopback, and the phone's local URLs that stand in for them.
public enum LocalUrls {
    /// An `http://localhost…` link, 127.0.0.1, [::1] and 0.0.0.0 alike; https can't pass a dev certificate.
    public static func link(_ href: String) -> SiteAddress? {
        let href = href.trimmingCharacters(in: .whitespacesAndNewlines)
        // Every code span in an answer is asked, and the regex is slow: most fail here first.
        guard href.prefix(7).lowercased() == "http://" else { return nil }
        let local = #/http://(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::(\d{1,5}))?([/?#]\S*)?/#
            .ignoresCase().asciiOnlyCharacterClasses()
        guard let m = try? local.wholeMatch(in: href),
            let port = Int(m.output.2 ?? "80"), (1...65535).contains(port)
        else { return nil }
        let rest = String(m.output.3 ?? "")
        return SiteAddress(port: port, path: rest.hasPrefix("/") ? rest : "/" + rest)
    }

    /// What someone typed: "5173", ":5173/x", "localhost:5173" or a whole local link.
    public static func typed(_ text: String) -> SiteAddress? {
        let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if t.isEmpty { return nil }
        if t.allSatisfy({ $0.isASCII && $0.isNumber }) {
            return Int(t).flatMap { (1...65535).contains($0) ? SiteAddress(port: $0) : nil }
        }
        if t.hasPrefix(":") { return link("http://localhost" + t) }
        if t.contains("://") { return link(t) }
        return link("http://" + t)
    }

    /// The phone's port for `desktopPort`: the same when the system lets an
    /// app take it, else 0 for any free one. Below 1024 needs root.
    public static func preferredPort(_ desktopPort: Int) -> Int {
        (1024...65535).contains(desktopPort) ? desktopPort : 0
    }

    /// What the phone's browser loads: the desktop's own origin when the port is the same.
    public static func local(_ address: SiteAddress, localPort: Int) -> String {
        localPort == address.port ? address.href : "http://127.0.0.1:\(localPort)\(address.path)"
    }

    /// Back from a URL the phone's browser is on to the desktop's address; nil for one no listener serves.
    public static func desktop(_ url: String, desktopPortOf: (_ localPort: Int) -> Int?) -> SiteAddress? {
        guard let on = link(url), let port = desktopPortOf(on.port) else { return nil }
        return SiteAddress(port: port, path: on.path)
    }
}
