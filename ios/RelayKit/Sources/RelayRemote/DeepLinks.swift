import Foundation

/// What a link opened from outside asks for (Android's DeepLinks.kt).
public enum DeepLink: Equatable, Sendable {
    case pair(PairingLink)
    /// `relay-native://chat/<id>`: a thread on the active computer.
    case thread(String)
}

public func parseDeepLink(_ url: String) -> DeepLink? {
    let text = url.trimmingCharacters(in: .whitespacesAndNewlines)
    guard let sep = text.range(of: "://") else { return nil }
    let scheme = text[..<sep.lowerBound].lowercased()
    guard scheme == "relay-native" || scheme == "relay-remote" else { return nil }
    let rest = text[sep.upperBound...]
    let host = rest.prefix { !"/?#".contains($0) }.lowercased()
    switch host {
    case "pair": return parsePairingURL("relay-remote://\(rest)").map(DeepLink.pair)
    case "chat":
        let id = rest.dropFirst(host.count).drop { $0 == "/" }.prefix { !"/?#".contains($0) }
        // A broken escape (`%zz`) is an unknown link, not a crash.
        guard let decoded = String(id).removingPercentEncoding, !decoded.isEmpty else { return nil }
        return .thread(decoded)
    default: return nil
    }
}
