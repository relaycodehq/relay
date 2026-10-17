import CryptoKit
import Foundation

public struct ChannelError: Error, CustomStringConvertible {
    public let description: String
}

/// Sealed frames, one counter per direction: ChaCha20-Poly1305 (RFC 8439), no AAD,
/// nonce = 4 zero bytes + 64-bit big-endian counter. A frame out of order fails to open.
/// Not thread-safe; the client uses it from its own queue only.
public final class Channel: @unchecked Sendable {
    private let sendKey: SymmetricKey
    private let receiveKey: SymmetricKey
    private var sent: UInt64 = 0
    private var received: UInt64 = 0

    init(sendKey: SymmetricKey, receiveKey: SymmetricKey) {
        self.sendKey = sendKey
        self.receiveKey = receiveKey
    }

    static func nonce(_ counter: UInt64) -> ChaChaPoly.Nonce {
        var bytes = Data(count: 4)
        withUnsafeBytes(of: counter.bigEndian) { bytes.append(contentsOf: $0) }
        return try! ChaChaPoly.Nonce(data: bytes)
    }

    public func seal(_ plain: Data) -> Data {
        let box = try! ChaChaPoly.seal(plain, using: sendKey, nonce: Self.nonce(sent))
        sent += 1
        return box.ciphertext + box.tag
    }

    public func seal(_ plain: String) -> Data { seal(Data(plain.utf8)) }

    /// Throws on a forged, reordered or replayed frame; the counter moves only on success.
    public func openBytes(_ frame: Data) throws -> Data {
        guard frame.count >= 16 else { throw ChannelError(description: "Frame too short.") }
        let box = try ChaChaPoly.SealedBox(
            nonce: Self.nonce(received),
            ciphertext: frame.prefix(frame.count - 16),
            tag: frame.suffix(16)
        )
        let plain = try ChaChaPoly.open(box, using: receiveKey)
        received += 1
        return plain
    }

    public func open(_ frame: Data) throws -> String {
        try strictUTF8(openBytes(frame))
    }
}

/// UTF-8 that refuses malformed input, like `new TextDecoder("utf-8", { fatal: true })`.
func strictUTF8(_ bytes: some Collection<UInt8>) throws -> String {
    guard let text = String(validating: bytes, as: UTF8.self) else {
        throw ChannelError(description: "Not UTF-8.")
    }
    return text
}
