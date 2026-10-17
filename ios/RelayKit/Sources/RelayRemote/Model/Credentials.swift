import Foundation

/// What a phone keeps of a paired computer; `key` (the desktop's public key) is its id.
public struct RemoteCredentials: Codable, Sendable, Equatable {
    public var hosts: [String]
    public var port: Int
    public var key: String
    public var name: String
    public var deviceId: String
    public var token: String
    /// Route order, first tried first; left out means local then Tailscale.
    public var routes: [RouteKind]?

    public init(
        hosts: [String], port: Int, key: String, name: String, deviceId: String, token: String,
        routes: [RouteKind]? = nil
    ) {
        self.hosts = hosts
        self.port = port
        self.key = key
        self.name = name
        self.deviceId = deviceId
        self.token = token
        self.routes = routes
    }
}
