import CryptoKit
import Foundation
import Testing

@testable import RelayRemote

// The Android app's TunnelFrameTest; shared/remote-tunnel.test.ts holds the same bytes.
struct TunnelFrameTests {
    let vectors: [(TunnelFrame, String)] = [
        (.open(stream: 1, port: 5177), "0201000000011439"),
        (.opened(stream: 0xdead_beef), "0202deadbeef"),
        (.data(stream: 2, bytes: Data("GET / HTTP/1.1\r\n".utf8)), "020300000002474554202f20485454502f312e310d0a"),
        (.credit(stream: 3, bytes: 65536), "02050000000300010000"),
        (.end(stream: 4), "020600000004"),
        (.close(stream: 5, reason: "Nothing ✓"), "0207000000054e6f7468696e6720e29c93"),
    ]

    func bytes(_ hex: String) -> Data {
        Data(stride(from: 0, to: hex.count, by: 2).map { at in
            let from = hex.index(hex.startIndex, offsetBy: at)
            return UInt8(hex[from..<hex.index(from, offsetBy: 2)], radix: 16)!
        })
    }

    @Test func laysFramesOutByteForByteAsTheDesktopDoes() throws {
        for (frame, expected) in vectors {
            #expect(hex(TunnelCodec.encode(frame)) == expected)
            #expect(try TunnelCodec.decode(bytes(expected)) == frame)
        }
        #expect(try TunnelCodec.decode(TunnelCodec.encode(.open(stream: 9, port: 65535))) == .open(stream: 9, port: 65535))
    }

    @Test func refusesFramesNoRelayWrites() {
        let bad = [
            "01", "020100000001", "02010000000114", "0208000000", "020800000001", "0202000000010000", "020300000001",
            "02050000000100",
        ]
        for frame in bad {
            #expect(throws: (any Error).self, "\(frame)") { try TunnelCodec.decode(bytes(frame)) }
        }
        var tooBig = Data(count: 6 + TunnelLimits.chunk + 1)
        tooBig[0] = 2
        tooBig[1] = 3
        #expect(throws: (any Error).self) { try TunnelCodec.decode(tooBig) }
    }

    @Test func ridesTheSealedChannelBesideJSONFramesInOrder() throws {
        let key = SymmetricKey(data: Data((0..<32).map { UInt8($0) }))
        let other = SymmetricKey(data: Data((1...32).map { UInt8($0) }))
        let desktop = Channel(sendKey: key, receiveKey: other)
        let phone = Channel(sendKey: other, receiveKey: key)
        let data = Data(repeating: 7, count: TunnelLimits.chunk)
        let sealed = [
            sealFrame(desktop, #"{"t":"tick"}"#, compact: true),
            sealTunnel(desktop, .data(stream: 9, bytes: data)),
            sealFrame(desktop, #"{"t":"tick","hosts":[]}"#, compact: true),
        ]
        let opened = try sealed.map { try openWire(phone, $0) }
        #expect(opened[0] == .json(#"{"t":"tick"}"#))
        #expect(opened[1] == .tunnel(.data(stream: 9, bytes: data)))
        #expect(opened[2] == .json(#"{"t":"tick","hosts":[]}"#))
    }
}
