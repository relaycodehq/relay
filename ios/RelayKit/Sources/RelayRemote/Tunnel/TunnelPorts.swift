import Foundation
import Synchronization

/// The desktop ports the phone's browser may open through the tunnel, per
/// paired computer: the ones Sites lists and the ones typed into its address
/// bar, which are kept. A link to any other port asks first, so neither a link
/// nor a page can walk the tunnel to whatever else listens on the computer.
/// The desktop checks the same.
public final class TunnelPorts: Sendable {
    public protocol Storage: Sendable {
        func read(_ computer: String) -> String?
        func write(_ computer: String, _ text: String)
        /// The computers with typed ports kept.
        func computers() -> Set<String>
        func remove(_ computer: String)
    }

    private struct State {
        var sites: [String: Set<Int>] = [:]
        var typed: [String: Set<Int>] = [:]
    }

    private let storage: any Storage
    private let state = Mutex(State())

    public init(storage: any Storage = DefaultsStorage()) {
        self.storage = storage
    }

    /// The ports Sites listed last on `computer`.
    public func sawSites(_ ports: [Int], on computer: String) {
        state.withLock { $0.sites[computer] = Set(ports) }
    }

    public func isTyped(_ port: Int, on computer: String) -> Bool {
        state.withLock { typed(&$0, computer).contains(port) }
    }

    /// Every port typed for `computer`.
    public func typedPorts(on computer: String) -> Set<Int> {
        state.withLock { typed(&$0, computer) }
    }

    public func allows(_ port: Int, on computer: String) -> Bool {
        state.withLock { $0.sites[computer]?.contains(port) == true || typed(&$0, computer).contains(port) }
    }

    public func type(_ port: Int, on computer: String) {
        state.withLock { s in
            var ports = typed(&s, computer)
            guard ports.insert(port).inserted else { return }
            s.typed[computer] = ports
            storage.write(computer, ports.sorted().map(String.init).joined(separator: ","))
        }
    }

    /// Drops what was kept for computers no longer paired.
    public func keepOnly(_ computers: Set<String>) {
        state.withLock { s in
            s.sites = s.sites.filter { computers.contains($0.key) }
            s.typed = s.typed.filter { computers.contains($0.key) }
            for gone in storage.computers().subtracting(computers) { storage.remove(gone) }
        }
    }

    private func typed(_ s: inout State, _ computer: String) -> Set<Int> {
        if let ports = s.typed[computer] { return ports }
        let saved = storage.read(computer)?.split(separator: ",").compactMap { Int($0.trimmingCharacters(in: .whitespaces)) }
        let ports = Set(saved ?? [])
        s.typed[computer] = ports
        return ports
    }

    /// Typed ports in UserDefaults, under "typed:<computer>" in a suite of their own.
    public struct DefaultsStorage: Storage {
        private static let prefix = "typed:"
        /// Thread-safe, as Apple documents it.
        nonisolated(unsafe) private let defaults: UserDefaults

        public init(suite: String = "relay-tunnel") {
            defaults = UserDefaults(suiteName: suite) ?? .standard
        }

        public func read(_ computer: String) -> String? { defaults.string(forKey: Self.prefix + computer) }

        public func write(_ computer: String, _ text: String) { defaults.set(text, forKey: Self.prefix + computer) }

        public func computers() -> Set<String> {
            Set(
                defaults.dictionaryRepresentation().keys
                    .filter { $0.hasPrefix(Self.prefix) }
                    .map { String($0.dropFirst(Self.prefix.count)) })
        }

        public func remove(_ computer: String) { defaults.removeObject(forKey: Self.prefix + computer) }
    }
}
