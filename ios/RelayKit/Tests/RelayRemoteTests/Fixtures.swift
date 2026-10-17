import Foundation
@testable import RelayRemote

/// Vectors the desktop's TypeScript produced (shared/remote-crypto, remote-wire,
/// remote-routes, remote-delta) with fixed keys: server static secret bytes
/// 1...32, client ephemeral 33...64, server ephemeral 65...96. The Android
/// app's TsVectors.kt holds the same.
enum Fixtures {
    static func load(_ name: String) -> JSON {
        let url = Bundle.module.url(forResource: name, withExtension: "json", subdirectory: "Fixtures")!
        return try! JSON.parse(Data(contentsOf: url))
    }

    static let crypto = load("ts-crypto")
    static let misc = load("ts-misc")
    /// ios/scripts/trace-fixtures.ts: shared/activity-labels and agent-trace on sample turns.
    static let trace = load("ts-trace")
}

func hex(_ bytes: Data) -> String { bytes.map { String(format: "%02x", $0) }.joined() }

func unhex(_ text: String) -> Data {
    var out = Data()
    var i = text.startIndex
    while i < text.endIndex {
        let j = text.index(i, offsetBy: 2)
        out.append(UInt8(text[i..<j], radix: 16)!)
        i = j
    }
    return out
}

func filled(from start: UInt8) -> Data { Data((0..<32).map { start + $0 }) }
