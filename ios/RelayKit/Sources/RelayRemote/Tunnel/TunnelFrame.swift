import Foundation

/// shared/remote-tunnel.ts: the limits both ends hold to.
public enum TunnelLimits {
    /// The wire's frame flag for tunnel frames, beside JSON as is (0) and deflated (1).
    public static let flag: UInt8 = 2
    /// The most of one stream's data either side holds unconsumed.
    public static let window = 256 * 1024
    /// The most data one frame carries.
    public static let chunk = 32 * 1024
    /// Streams one phone may have open at once; the desktop refuses more.
    public static let maxStreams = 24
    static let maxReason = 500

    /// Cut as the desktop's `slice` cuts it, in UTF-16 units.
    static func reason(_ text: String) -> String {
        text.utf16.count <= maxReason ? text : String(decoding: Array(text.utf16.prefix(maxReason)), as: UTF16.self)
    }
}

/// A port tunnel frame: flag, op, stream id (u32 big-endian), then what the
/// op carries. Only the phone opens streams; ids are its own.
public enum TunnelFrame: Sendable, Equatable {
    case open(stream: UInt32, port: Int)
    case opened(stream: UInt32)
    /// `packed`: raw DEFLATE of the bytes.
    case data(stream: UInt32, bytes: Data, packed: Bool = false)
    /// Bytes the sender consumed since its last credit.
    case credit(stream: UInt32, bytes: Int)
    /// The sender's side is done (TCP FIN).
    case end(stream: UInt32)
    /// The stream is gone both ways; also an open's refusal. Empty `reason` for an ordinary end.
    case close(stream: UInt32, reason: String)

    public var stream: UInt32 {
        switch self {
        case .open(let s, _), .opened(let s), .data(let s, _, _), .credit(let s, _), .end(let s), .close(let s, _): s
        }
    }
}

public enum TunnelCodec {
    private static let open: UInt8 = 1
    private static let opened: UInt8 = 2
    private static let data: UInt8 = 3
    private static let packed: UInt8 = 4
    private static let credit: UInt8 = 5
    private static let end: UInt8 = 6
    private static let close: UInt8 = 7

    /// The frame's plain bytes, flag first, ready to seal.
    public static func encode(_ frame: TunnelFrame) -> Data {
        let op: UInt8
        var body = Data()
        switch frame {
        case .open(_, let port):
            op = open
            append(&body, UInt16(truncatingIfNeeded: port))
        case .opened: op = opened
        case .data(_, let bytes, let isPacked):
            op = isPacked ? packed : data
            body = bytes
        case .credit(_, let bytes):
            op = credit
            append(&body, UInt32(truncatingIfNeeded: bytes))
        case .end: op = end
        case .close(_, let reason):
            op = close
            body = Data(TunnelLimits.reason(reason).utf8)
        }
        var plain = Data(capacity: 6 + body.count)
        plain.append(TunnelLimits.flag)
        plain.append(op)
        append(&plain, frame.stream)
        plain.append(body)
        return plain
    }

    /// Throws on a frame that isn't one: a sender that writes those isn't Relay.
    public static func decode(_ plain: Data) throws -> TunnelFrame {
        let at = plain.startIndex
        guard plain.count >= 6, plain[at] == TunnelLimits.flag else {
            throw ChannelError(description: "Not a tunnel frame.")
        }
        let op = plain[at + 1]
        let stream = UInt32(read(plain, at + 2, 4))
        let size = plain.count - 6
        func sized(_ n: Int) throws {
            guard size == n else { throw ChannelError(description: "Bad tunnel frame.") }
        }
        switch op {
        case open:
            try sized(2)
            return .open(stream: stream, port: Int(read(plain, at + 6, 2)))
        case opened:
            try sized(0)
            return .opened(stream: stream)
        case data, packed:
            guard (1...TunnelLimits.chunk).contains(size) else { throw ChannelError(description: "Bad tunnel data.") }
            return .data(stream: stream, bytes: Data(plain.suffix(size)), packed: op == packed)
        case credit:
            try sized(4)
            return .credit(stream: stream, bytes: Int(read(plain, at + 6, 4)))
        case end:
            try sized(0)
            return .end(stream: stream)
        case close:
            return .close(stream: stream, reason: try strictUTF8(plain.suffix(size)))
        default:
            throw ChannelError(description: "Unknown tunnel frame.")
        }
    }

    private static func append<T: FixedWidthInteger>(_ data: inout Data, _ value: T) {
        withUnsafeBytes(of: value.bigEndian) { data.append(contentsOf: $0) }
    }

    /// `count` bytes from `from`, big-endian.
    private static func read(_ data: Data, _ from: Int, _ count: Int) -> UInt64 {
        data[from..<from + count].reduce(0) { $0 << 8 | UInt64($1) }
    }
}
