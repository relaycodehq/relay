import CryptoKit
import Foundation

/// The bridge's protocol (`remoteProtocol`); a hello with any other `v` is refused.
public let remoteProtocol = 1

public struct HandshakeError: Error, Equatable, CustomStringConvertible {
    public let description: String
    static let invalid = HandshakeError(description: "Invalid key exchange.")
    static let otherProtocol = HandshakeError(description: "This Relay speaks a different remote protocol.")
}

private let salt = Data("relay-remote/1".utf8)

public struct KeyPair: Sendable {
    let secret: Curve25519.KeyAgreement.PrivateKey
    public var publicKey: Data { secret.publicKey.rawRepresentation }

    public static func generate() -> KeyPair { KeyPair(secret: .init()) }

    public static func fromSecret(_ bytes: Data) throws -> KeyPair {
        KeyPair(secret: try .init(rawRepresentation: bytes))
    }
}

/// X25519, refusing the all-zero secret a low-order peer key gives.
func dh(_ secret: KeyPair, _ peer: Data) throws -> Data {
    guard peer.count == 32, let key = try? Curve25519.KeyAgreement.PublicKey(rawRepresentation: peer),
        let shared = try? secret.secret.sharedSecretFromKeyAgreement(with: key)
    else { throw HandshakeError.invalid }
    let bytes = shared.withUnsafeBytes { Data($0) }
    guard bytes.contains(where: { $0 != 0 }) else { throw HandshakeError.invalid }
    return bytes
}

struct SessionKeys {
    let toServer: SymmetricKey
    let toClient: SymmetricKey
}

/// HKDF-SHA256(es || ee, "relay-remote/1", serverStatic || clientEphemeral || serverEphemeral, 64).
func derive(es: Data, ee: Data, serverStatic: Data, clientEphemeral: Data, serverEphemeral: Data) -> SessionKeys {
    let okm = HKDF<SHA256>.deriveKey(
        inputKeyMaterial: SymmetricKey(data: es + ee),
        salt: salt,
        info: serverStatic + clientEphemeral + serverEphemeral,
        outputByteCount: 64
    ).withUnsafeBytes { Data($0) }
    return SessionKeys(toServer: SymmetricKey(data: okm.prefix(32)), toClient: SymmetricKey(data: okm.suffix(32)))
}

/// Written out by hand: keys in the order the TS writes them, so hellos match byte for byte.
func helloFrame(_ key: Data) -> String {
    "{\"t\":\"hello\",\"v\":\(remoteProtocol),\"e\":\"\(Base64URL.encode(key))\"}"
}

/// The ephemeral key in a peer's hello; throws on anything else.
func helloKey(_ text: String) throws -> Data {
    let frame = try? JSON.parse(text)
    guard frame?["t"]?.string == "hello", frame?["v"]?.number == Double(remoteProtocol) else {
        throw HandshakeError.otherProtocol
    }
    guard let e = frame?["e"]?.string, let key = Base64URL.decode(e), key.count == 32 else {
        throw HandshakeError.invalid
    }
    return key
}

/// The phone's side: send `hello`, then `finish` with the desktop's reply.
public struct ClientHandshake: Sendable {
    let serverKey: Data
    let ephemeral: KeyPair
    public let hello: String

    public init(serverKey: Data, ephemeral: KeyPair = .generate()) {
        self.serverKey = serverKey
        self.ephemeral = ephemeral
        hello = helloFrame(ephemeral.publicKey)
    }

    public func finish(_ reply: String) throws -> Channel {
        let serverEphemeral = try helloKey(reply)
        let keys = derive(
            es: try dh(ephemeral, serverKey),
            ee: try dh(ephemeral, serverEphemeral),
            serverStatic: serverKey,
            clientEphemeral: ephemeral.publicKey,
            serverEphemeral: serverEphemeral
        )
        return Channel(sendKey: keys.toServer, receiveKey: keys.toClient)
    }
}

/// The desktop's side, for tests and a stand-in desktop.
public struct ServerHandshake {
    public let hello: String
    public let channel: Channel

    public init(staticKey: KeyPair, clientHello: String, ephemeral: KeyPair = .generate()) throws {
        let clientEphemeral = try helloKey(clientHello)
        let keys = derive(
            es: try dh(staticKey, clientEphemeral),
            ee: try dh(ephemeral, clientEphemeral),
            serverStatic: staticKey.publicKey,
            clientEphemeral: clientEphemeral,
            serverEphemeral: ephemeral.publicKey
        )
        hello = helloFrame(ephemeral.publicKey)
        channel = Channel(sendKey: keys.toClient, receiveKey: keys.toServer)
    }
}
