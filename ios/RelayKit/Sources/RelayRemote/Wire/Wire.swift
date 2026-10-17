import Foundation

/// One WebSocket frame: base64url text before compact mode, sealed bytes after.
public enum WireData: Sendable, Equatable {
    case text(String)
    case binary(Data)
}

/// What a frame opens to: JSON, or (bridge 23) a port tunnel frame.
public enum Opened: Equatable {
    case json(String)
    case tunnel(TunnelFrame)
}

private let raw: UInt8 = 0
private let deflated: UInt8 = 1

/// `sealFrame`: text = base64url(seal(json)); compact = seal(flag || json or deflate(json)).
public func sealFrame(_ channel: Channel, _ json: String, compact: Bool) -> WireData {
    guard compact else { return .text(Base64URL.encode(channel.seal(json))) }
    let bytes = Data(json.utf8)
    var flag = raw
    var body = bytes
    if bytes.count >= Codec.deflateFrom, bytes.count <= Codec.deflateUpTo,
        let packed = try? Codec.deflate(bytes), packed.count < bytes.count
    {
        flag = deflated
        body = packed
    }
    var plain = Data([flag])
    plain.append(body)
    return .binary(channel.seal(plain))
}

/// Throws on anything that doesn't open, has an unknown flag or is a malformed tunnel frame.
public func openWire(_ channel: Channel, _ data: WireData) throws -> Opened {
    switch data {
    case .text(let text):
        guard let bytes = Base64URL.decode(text) else { throw ChannelError(description: "Not base64url.") }
        return .json(try channel.open(bytes))
    case .binary(let bytes):
        let plain = try channel.openBytes(bytes)
        guard let flag = plain.first else { throw ChannelError(description: "Unknown frame.") }
        let body = plain.dropFirst()
        switch flag {
        case raw: return .json(try strictUTF8(body))
        case deflated: return .json(try strictUTF8(Codec.inflate(Data(body))))
        case TunnelLimits.flag: return .tunnel(try TunnelCodec.decode(plain))
        default: throw ChannelError(description: "Unknown frame.")
        }
    }
}

/// `openFrame`: the JSON text inside.
public func openFrame(_ channel: Channel, _ data: WireData) throws -> String {
    guard case .json(let text) = try openWire(channel, data) else { throw ChannelError(description: "Unknown frame.") }
    return text
}

/// A tunnel frame, sealed as it is: always binary, since the tunnel's bridge is past compact's.
public func sealTunnel(_ channel: Channel, _ frame: TunnelFrame) -> WireData {
    .binary(channel.seal(TunnelCodec.encode(frame)))
}
