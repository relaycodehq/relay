import CryptoKit
import Foundation
import Testing
@testable import RelayRemote

/// The Swift port against what the TypeScript bridge produced.
struct CrossImplementationTests {
    let v = Fixtures.crypto
    let server = try! KeyPair.fromSecret(filled(from: 1))
    let client = try! KeyPair.fromSecret(filled(from: 33))
    let serverEphemeral = try! KeyPair.fromSecret(filled(from: 65))

    func str(_ key: String) -> String { v[key]!.string! }

    func channel() throws -> Channel {
        try ClientHandshake(serverKey: server.publicKey, ephemeral: client).finish(str("serverHello"))
    }

    @Test func publicKeysAndHellosMatch() throws {
        #expect(Base64URL.encode(server.publicKey) == str("serverStaticPub"))
        #expect(ClientHandshake(serverKey: server.publicKey, ephemeral: client).hello == str("clientHello"))
        let side = try ServerHandshake(staticKey: server, clientHello: str("clientHello"), ephemeral: serverEphemeral)
        #expect(side.hello == str("serverHello"))
    }

    @Test func sessionKeysMatch() throws {
        let keys = derive(
            es: try dh(client, server.publicKey),
            ee: try dh(client, serverEphemeral.publicKey),
            serverStatic: server.publicKey,
            clientEphemeral: client.publicKey,
            serverEphemeral: serverEphemeral.publicKey
        )
        #expect(hex(keys.toServer.withUnsafeBytes { Data($0) }) == str("toServer"))
        #expect(hex(keys.toClient.withUnsafeBytes { Data($0) }) == str("toClient"))
    }

    @Test func sealsAtCountersZeroAndOneMatch() throws {
        let c = try channel()
        #expect(hex(c.seal("hello relay")) == str("clientSeal0"))
        #expect(hex(c.seal("hello relay")) == str("clientSeal1"))
    }

    @Test func framesTheDesktopSealedOpenHere() throws {
        let c = try channel()
        let frames = v["serverFrames"]!.array!.map { $0.string! }
        #expect(
            try openFrame(c, .text(frames[0]))
                == #"{"t":"ready","name":"Mac","bridge":21,"hosts":["192.168.1.2","100.100.1.1"]}"#
        )
        #expect(try openFrame(c, .binary(Base64URL.decode(frames[1])!)) == #"{"t":"tick"}"#)
        // node:zlib's deflateRawSync, then fflate's.
        #expect(try openFrame(c, .binary(Base64URL.decode(frames[2])!)) == str("bigJson"))
        #expect(try openFrame(c, .binary(Base64URL.decode(frames[3])!)) == str("bigJson"))
    }

    @Test func serverOpensWhatTheClientSeals() throws {
        let clientSide = ClientHandshake(serverKey: server.publicKey, ephemeral: client)
        let serverSide = try ServerHandshake(staticKey: server, clientHello: clientSide.hello, ephemeral: serverEphemeral)
        let c = try clientSide.finish(serverSide.hello)
        let big = str("bigJson")
        for (json, compact) in [(#"{"t":"got","s":1}"#, false), (#"{"t":"got","s":2}"#, true), (big, true)] {
            #expect(try openFrame(serverSide.channel, sealFrame(c, json, compact: compact)) == json)
        }
        guard case .binary(let packed) = sealFrame(c, big, compact: true) else {
            Issue.record("Compact frames are binary.")
            return
        }
        #expect(packed.count < big.utf8.count / 2)
    }

    @Test func base64URLMatchesAndRefusesPaddingAndStrays() {
        for pair in v["b64"]!.array! {
            let h = pair.array![0].string!
            let b = pair.array![1].string!
            let bytes = Base64URL.decode(b)
            #expect(bytes.map(hex) == h)
            #expect(Base64URL.encode(unhex(h)) == b)
        }
        for bad in ["AA==", "AA=", "A", "AA+", "AA/", "AA E"] {
            #expect(Base64URL.decode(bad) == nil)
        }
    }

    @Test func allZeroSharedSecretIsRefused() {
        #expect(throws: HandshakeError.invalid) { try dh(client, Data(count: 32)) }
    }

    @Test func helloThatIsNotProtocolOneIsRefused() throws {
        let e = Base64URL.encode(client.publicKey)
        for bad in [
            #"{"t":"hello","v":"1","e":"\#(e)"}"#,
            #"{"t":"hello","v":2,"e":"\#(e)"}"#,
            #"{"t":"hi","v":1,"e":"\#(e)"}"#,
            #"{"t":"hello","v":1,"e":"AAAA"}"#,
        ] {
            #expect(throws: HandshakeError.self) { try helloKey(bad) }
        }
        #expect(try helloKey(#"{"t":"hello","v":1,"e":"\#(e)"}"#) == client.publicKey)
    }

    @Test func tamperedOrReplayedFrameDoesNotOpen() throws {
        let clientSide = ClientHandshake(serverKey: server.publicKey, ephemeral: client)
        let serverSide = try ServerHandshake(staticKey: server, clientHello: clientSide.hello, ephemeral: serverEphemeral)
        let c = try clientSide.finish(serverSide.hello)
        let sealed = c.seal("one")
        var tampered = sealed
        tampered[tampered.startIndex] ^= 1
        #expect(throws: (any Error).self) { try serverSide.channel.open(tampered) }
        #expect(try serverSide.channel.open(sealed) == "one")
        #expect(throws: (any Error).self) { try serverSide.channel.open(sealed) }
    }

    @Test func inflateRefusesTruncatedAndOversizedStreams() throws {
        let big = Data(str("bigJson").utf8)
        let packed = try Codec.deflate(big)
        #expect(try Codec.inflate(packed) == big)
        #expect(throws: CodecError.self) { try Codec.inflate(packed.prefix(packed.count / 2)) }
        #expect(throws: CodecError.self) { try Codec.inflate(packed, cap: 100) }
    }
}
