import CommonCrypto
import Foundation

/// A PIN as PBKDF2-HMAC-SHA256 of a random salt; Android: `StoredPin`, same bytes.
public struct StoredPin: Codable, Equatable, Sendable {
    public static let rounds = 100_000

    public let salt: String
    public let hash: String
    public let rounds: Int

    public init(salt: String, hash: String, rounds: Int) {
        self.salt = salt
        self.hash = hash
        self.rounds = rounds
    }

    public static func of(_ pin: String, salt: Data = random(16), rounds: Int = StoredPin.rounds) -> StoredPin {
        StoredPin(salt: salt.base64EncodedString(), hash: derive(pin, salt, rounds).base64EncodedString(), rounds: rounds)
    }

    public func matches(_ pin: String) -> Bool {
        guard let salt = Data(base64Encoded: salt), let hash = Data(base64Encoded: hash) else { return false }
        let derived = Self.derive(pin, salt, rounds)
        // Every byte compared, whatever the first wrong one.
        return derived.count == hash.count && zip(derived, hash).reduce(0) { $0 | ($1.0 ^ $1.1) } == 0
    }

    private static func derive(_ pin: String, _ salt: Data, _ rounds: Int) -> Data {
        let password = Array(pin.utf8).map { CChar(bitPattern: $0) }
        var out = [UInt8](repeating: 0, count: 32)
        salt.withUnsafeBytes { salt in
            _ = CCKeyDerivationPBKDF(
                CCPBKDFAlgorithm(kCCPBKDF2), password, password.count,
                salt.bindMemory(to: UInt8.self).baseAddress, salt.count,
                CCPseudoRandomAlgorithm(kCCPRFHmacAlgSHA256), UInt32(rounds), &out, out.count)
        }
        return Data(out)
    }

    public static func random(_ count: Int) -> Data {
        var bytes = [UInt8](repeating: 0, count: count)
        _ = SecRandomCopyBytes(kSecRandomDefault, count, &bytes)
        return Data(bytes)
    }
}
