import Foundation

/// RFC 4648 base64url without padding, decoding exactly as `shared/remote-crypto.ts`
/// does: any character outside the alphabet, or a length of 4n+1, is refused.
public enum Base64URL {
    private static let alphabet = Array("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_".utf8)
    private static let values: [Int8] = {
        var v = [Int8](repeating: -1, count: 128)
        for (i, c) in alphabet.enumerated() { v[Int(c)] = Int8(i) }
        return v
    }()

    public static func encode(_ bytes: some Collection<UInt8>) -> String {
        let bytes = Array(bytes)
        var out = [UInt8]()
        out.reserveCapacity((bytes.count * 4 + 2) / 3)
        var i = 0
        while i < bytes.count {
            let b0 = UInt32(bytes[i])
            let b1 = i + 1 < bytes.count ? UInt32(bytes[i + 1]) : 0
            let b2 = i + 2 < bytes.count ? UInt32(bytes[i + 2]) : 0
            let n = b0 << 16 | b1 << 8 | b2
            let count = min(4, ((bytes.count - i) * 8 + 5) / 6)
            for j in 0..<count { out.append(alphabet[Int(n >> (18 - 6 * UInt32(j)) & 63)]) }
            i += 3
        }
        return String(decoding: out, as: UTF8.self)
    }

    public static func decode(_ text: String) -> Data? {
        let chars = Array(text.utf8)
        guard chars.count % 4 != 1 else { return nil }
        var out = Data(capacity: chars.count * 6 / 8)
        var bits = 0
        var value: UInt32 = 0
        for c in chars {
            guard c < 128, values[Int(c)] >= 0 else { return nil }
            value = (value << 6 | UInt32(values[Int(c)])) & 0xFFFFFF
            bits += 6
            if bits >= 8 {
                bits -= 8
                out.append(UInt8(value >> UInt32(bits) & 255))
            }
        }
        return out
    }

    /// `randomToken(n)`: base64url of n random bytes.
    public static func randomToken(_ count: Int) -> String {
        var bytes = [UInt8](repeating: 0, count: count)
        for i in bytes.indices { bytes[i] = UInt8.random(in: 0...255) }
        return encode(bytes)
    }
}
