import Foundation

/// What the desktop's QR code carries; `key` pins the desktop the phone may talk to.
public struct PairingLink: Codable, Sendable, Equatable {
    public var hosts: [String]
    public var port: Int
    /// The desktop's X25519 public key, base64url.
    public var key: String
    /// One-time secret, traded for a device token on first contact.
    public var code: String
    public var name: String

    public init(hosts: [String], port: Int, key: String, code: String, name: String) {
        self.hosts = hosts
        self.port = port
        self.key = key
        self.code = code
        self.name = name
    }
}

private nonisolated(unsafe) let validName = /^[A-Za-z0-9.\-]{1,253}$/
private nonisolated(unsafe) let validV6 = /^\[[0-9a-fA-F:]+\]$/
private nonisolated(unsafe) let keyPattern = /^[A-Za-z0-9_\-]{43}$/
private nonisolated(unsafe) let codePattern = /^[A-Za-z0-9_\-]{16,64}$/
// JS `.` stops at line terminators, `$` without /m only at the very end.
private nonisolated(unsafe) let pairQuery = /[\/:]pair\?([^\n\r\u{2028}\u{2029}]+)\z/

public func validHost(_ host: String) -> Bool {
    host.wholeMatch(of: validName) != nil || host.wholeMatch(of: validV6) != nil
}

/// `parsePairingUrl`: the link itself or a URL wrapping it, e.g. Expo Go's `exp://…/--/pair?…`.
public func parsePairingURL(_ text: String) -> PairingLink? {
    let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard let match = trimmed.firstMatch(of: pairQuery) else { return nil }
    let q = parseQuery(String(match.1))
    let hosts = (q["h"] ?? "").split(separator: ",", omittingEmptySubsequences: false).map(String.init).filter(validHost)
    let port = jsNumber(q["p"])
    let key = q["k"] ?? ""
    let code = q["c"] ?? ""
    let name = utf16Prefix(q["n"] ?? "", 80)
    guard !hosts.isEmpty, port.isFinite, port == port.rounded(.down), port >= 1, port <= 65535,
        key.wholeMatch(of: keyPattern) != nil, code.wholeMatch(of: codePattern) != nil
    else { return nil }
    return PairingLink(hosts: hosts, port: Int(port), key: key, code: code, name: name.isEmpty ? "Relay" : name)
}

/// `pairingUrl`, form-encoded as URLSearchParams does.
public func pairingURL(_ link: PairingLink) -> String {
    "relay-remote://pair?h=\(formEncode(link.hosts.joined(separator: ",")))&p=\(link.port)"
        + "&k=\(formEncode(link.key))&c=\(formEncode(link.code))&n=\(formEncode(link.name))"
}

/// application/x-www-form-urlencoded as URLSearchParams writes it.
private func formEncode(_ text: String) -> String {
    var out = ""
    for byte in text.utf8 {
        switch byte {
        case UInt8(ascii: "a")...UInt8(ascii: "z"), UInt8(ascii: "A")...UInt8(ascii: "Z"),
            UInt8(ascii: "0")...UInt8(ascii: "9"), UInt8(ascii: "*"), UInt8(ascii: "-"), UInt8(ascii: "."),
            UInt8(ascii: "_"):
            out.unicodeScalars.append(Unicode.Scalar(byte))
        case UInt8(ascii: " "): out += "+"
        default: out += String(format: "%%%02X", byte)
        }
    }
    return out
}

/// URLSearchParams: first value wins in `get`, `+` is a space, a bad escape stays as written.
private func parseQuery(_ query: String) -> [String: String] {
    var out = [String: String]()
    for part in query.split(separator: "&", omittingEmptySubsequences: true) {
        let name: Substring
        let value: Substring
        if let eq = part.firstIndex(of: "=") {
            name = part[..<eq]
            value = part[part.index(after: eq)...]
        } else {
            name = part
            value = ""
        }
        let key = formDecode(name)
        if out[key] == nil { out[key] = formDecode(value) }
    }
    return out
}

private func formDecode(_ text: Substring) -> String {
    let bytes = Array(text.utf8)
    var out = [UInt8]()
    out.reserveCapacity(bytes.count)
    var i = 0
    func hex(_ c: UInt8) -> UInt8? {
        switch c {
        case UInt8(ascii: "0")...UInt8(ascii: "9"): c - UInt8(ascii: "0")
        case UInt8(ascii: "a")...UInt8(ascii: "f"): c - UInt8(ascii: "a") + 10
        case UInt8(ascii: "A")...UInt8(ascii: "F"): c - UInt8(ascii: "A") + 10
        default: nil
        }
    }
    while i < bytes.count {
        let c = bytes[i]
        if c == UInt8(ascii: "+") {
            out.append(UInt8(ascii: " "))
        } else if c == UInt8(ascii: "%"), i + 2 < bytes.count, let hi = hex(bytes[i + 1]), let lo = hex(bytes[i + 2]) {
            out.append(hi << 4 | lo)
            i += 2
        } else {
            out.append(c)
        }
        i += 1
    }
    // Bad UTF-8 turns into U+FFFD, as URLSearchParams decodes it.
    return String(decoding: out, as: UTF8.self)
}

/// `text.slice(0, n)`: JS strings count UTF-16 units.
func utf16Prefix(_ text: String, _ count: Int) -> String {
    let units = text.utf16
    guard units.count > count else { return text }
    return String(decoding: Array(units.prefix(count)), as: UTF16.self)
}

private nonisolated(unsafe) let jsDecimal = /^[+\-]?(?:Infinity|(?:\d+\.?\d*|\.\d+)(?:[eE][+\-]?\d+)?)$/

/// JavaScript's `Number(text)`: trimmed, empty is 0, hex/octal/binary literals, else NaN.
func jsNumber(_ text: String?) -> Double {
    guard let text else { return 0 }
    let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
    if t.isEmpty { return 0 }
    let lower = t.lowercased()
    for (prefix, radix) in [("0x", 16), ("0o", 8), ("0b", 2)] where lower.hasPrefix(prefix) {
        let digits = lower.dropFirst(2)
        guard !digits.isEmpty else { return .nan }
        var value = 0.0
        for c in digits {
            guard let d = c.hexDigitValue, d < radix else { return .nan }
            value = value * Double(radix) + Double(d)
        }
        return value
    }
    guard t.wholeMatch(of: jsDecimal) != nil else { return .nan }
    switch t {
    case "Infinity", "+Infinity": return .infinity
    case "-Infinity": return -.infinity
    default: return Double(t) ?? .nan
    }
}
