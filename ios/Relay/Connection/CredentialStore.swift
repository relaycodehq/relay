import Foundation
import RelayRemote
import Security

/// Paired computers in the Keychain, one item each (keyed by the desktop's
/// public key), plus which one is active. Only this device can read them.
struct CredentialStore {
    private let service = "dev.relay.computers"
    private let indexAccount = "index"

    struct Index: Codable {
        /// Pairing order, oldest first.
        var ids: [String] = []
        var active: String?
    }

    func load() -> (computers: [RemoteCredentials], active: String?) {
        let index = read(indexAccount).flatMap { try? JSONDecoder().decode(Index.self, from: $0) } ?? Index()
        let computers = index.ids.compactMap { id in
            read("computer-\(id)").flatMap { try? JSONDecoder().decode(RemoteCredentials.self, from: $0) }
        }
        return (computers, index.active)
    }

    func save(_ computers: [RemoteCredentials], active: String?) {
        let known = Set(computers.map(\.key))
        for id in (read(indexAccount).flatMap { try? JSONDecoder().decode(Index.self, from: $0) }?.ids ?? [])
        where !known.contains(id) {
            delete("computer-\(id)")
        }
        for c in computers {
            if let data = try? JSONEncoder().encode(c) { write("computer-\(c.key)", data) }
        }
        if let data = try? JSONEncoder().encode(Index(ids: computers.map(\.key), active: active)) {
            write(indexAccount, data)
        }
    }

    private func query(_ account: String) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account]
    }

    private func read(_ account: String) -> Data? {
        var q = query(account)
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: CFTypeRef?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess else { return nil }
        return out as? Data
    }

    private func write(_ account: String, _ data: Data) {
        let attributes: [String: Any] = [
            kSecValueData as String: data,
            // Readable in the background once the phone was unlocked, so a reconnect works with it locked.
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        ]
        if SecItemUpdate(query(account) as CFDictionary, attributes as CFDictionary) == errSecItemNotFound {
            SecItemAdd(query(account).merging(attributes) { $1 } as CFDictionary, nil)
        }
    }

    private func delete(_ account: String) {
        SecItemDelete(query(account) as CFDictionary)
    }
}
