import Foundation

/// Decodes a model straight from a `JSON` tree, so a patched message or a
/// frame's payload doesn't go back through bytes. Unknown keys are ignored and
/// a JSON null reads as an absent optional, as the desktop's newer fields need.
struct JSONValueDecoder: Decoder {
    let value: JSON
    var codingPath: [CodingKey] = []
    var userInfo: [CodingUserInfoKey: Any] { [:] }

    init(_ value: JSON, codingPath: [CodingKey] = []) {
        self.value = value
        self.codingPath = codingPath
    }

    func container<Key: CodingKey>(keyedBy type: Key.Type) throws -> KeyedDecodingContainer<Key> {
        guard case .object(let fields) = value else { throw mismatch([String: JSON].self) }
        return KeyedDecodingContainer(Keyed(fields: fields, codingPath: codingPath))
    }

    func unkeyedContainer() throws -> UnkeyedDecodingContainer {
        guard case .array(let items) = value else { throw mismatch([JSON].self) }
        return Unkeyed(items: items, codingPath: codingPath)
    }

    func singleValueContainer() throws -> SingleValueDecodingContainer { Single(value: value, codingPath: codingPath) }

    private func mismatch(_ type: Any.Type) -> DecodingError {
        .typeMismatch(type, .init(codingPath: codingPath, debugDescription: "Expected \(type), found \(value)."))
    }
}

private struct AnyKey: CodingKey {
    var stringValue: String
    var intValue: Int?
    init(stringValue: String) { self.stringValue = stringValue }
    init(intValue: Int) {
        stringValue = String(intValue)
        self.intValue = intValue
    }
}

private func decodeScalar<T: Decodable>(_ type: T.Type, from value: JSON, at path: [CodingKey]) throws -> T {
    func fail() -> DecodingError {
        .typeMismatch(type, .init(codingPath: path, debugDescription: "Expected \(type), found \(value)."))
    }
    switch type {
    case is JSON.Type: return value as! T
    case is String.Type:
        guard case .string(let s) = value else { throw fail() }
        return s as! T
    case is Bool.Type:
        guard case .bool(let b) = value else { throw fail() }
        return b as! T
    case is Double.Type:
        guard case .number(let n) = value else { throw fail() }
        return n as! T
    case is Float.Type:
        guard case .number(let n) = value else { throw fail() }
        return Float(n) as! T
    case is Int.Type:
        guard let n = value.int else { throw fail() }
        return n as! T
    case is Int64.Type:
        guard let n = value.int else { throw fail() }
        return Int64(n) as! T
    case is Int32.Type:
        guard let n = value.int, let v = Int32(exactly: n) else { throw fail() }
        return v as! T
    case is UInt.Type:
        guard let n = value.int, n >= 0 else { throw fail() }
        return UInt(n) as! T
    default:
        return try T(from: JSONValueDecoder(value, codingPath: path))
    }
}

private struct Keyed<Key: CodingKey>: KeyedDecodingContainerProtocol {
    let fields: [String: JSON]
    let codingPath: [CodingKey]

    var allKeys: [Key] { fields.keys.compactMap(Key.init(stringValue:)) }

    func contains(_ key: Key) -> Bool { fields[key.stringValue] != nil }

    private func value(_ key: Key) throws -> JSON {
        guard let v = fields[key.stringValue] else {
            throw DecodingError.keyNotFound(key, .init(codingPath: codingPath, debugDescription: "No \(key.stringValue)."))
        }
        return v
    }

    func decodeNil(forKey key: Key) throws -> Bool { (fields[key.stringValue] ?? .null) == .null }

    func decode<T: Decodable>(_ type: T.Type, forKey key: Key) throws -> T {
        try decodeScalar(type, from: value(key), at: codingPath + [key])
    }

    /// An optional field of another shape reads as absent, so a desktop that
    /// changed one doesn't cost the phone the whole thread.
    func decodeIfPresent<T: Decodable>(_ type: T.Type, forKey key: Key) throws -> T? {
        guard let v = fields[key.stringValue], v != .null else { return nil }
        do {
            return try decodeScalar(type, from: v, at: codingPath + [key])
        } catch DecodingError.typeMismatch {
            return nil
        }
    }

    func nestedContainer<NestedKey: CodingKey>(keyedBy type: NestedKey.Type, forKey key: Key) throws
        -> KeyedDecodingContainer<NestedKey>
    {
        try JSONValueDecoder(value(key), codingPath: codingPath + [key]).container(keyedBy: type)
    }

    func nestedUnkeyedContainer(forKey key: Key) throws -> UnkeyedDecodingContainer {
        try JSONValueDecoder(value(key), codingPath: codingPath + [key]).unkeyedContainer()
    }

    func superDecoder() throws -> Decoder { JSONValueDecoder(.object(fields), codingPath: codingPath) }

    func superDecoder(forKey key: Key) throws -> Decoder {
        JSONValueDecoder(fields[key.stringValue] ?? .null, codingPath: codingPath + [key])
    }
}

private struct Unkeyed: UnkeyedDecodingContainer {
    let items: [JSON]
    let codingPath: [CodingKey]
    var currentIndex = 0

    init(items: [JSON], codingPath: [CodingKey]) {
        self.items = items
        self.codingPath = codingPath
    }

    var count: Int? { items.count }
    var isAtEnd: Bool { currentIndex >= items.count }

    private var path: [CodingKey] { codingPath + [AnyKey(intValue: currentIndex)] }

    private func current() throws -> JSON {
        guard !isAtEnd else {
            throw DecodingError.valueNotFound(JSON.self, .init(codingPath: path, debugDescription: "Past the end."))
        }
        return items[currentIndex]
    }

    mutating func decodeNil() throws -> Bool {
        if try current() == .null {
            currentIndex += 1
            return true
        }
        return false
    }

    mutating func decode<T: Decodable>(_ type: T.Type) throws -> T {
        let v = try decodeScalar(type, from: current(), at: path)
        currentIndex += 1
        return v
    }

    mutating func nestedContainer<NestedKey: CodingKey>(keyedBy type: NestedKey.Type) throws
        -> KeyedDecodingContainer<NestedKey>
    {
        let c = try JSONValueDecoder(current(), codingPath: path).container(keyedBy: type)
        currentIndex += 1
        return c
    }

    mutating func nestedUnkeyedContainer() throws -> UnkeyedDecodingContainer {
        let c = try JSONValueDecoder(current(), codingPath: path).unkeyedContainer()
        currentIndex += 1
        return c
    }

    mutating func superDecoder() throws -> Decoder {
        let d = try JSONValueDecoder(current(), codingPath: path)
        currentIndex += 1
        return d
    }
}

private struct Single: SingleValueDecodingContainer {
    let value: JSON
    let codingPath: [CodingKey]

    func decodeNil() -> Bool { value == .null }

    func decode<T: Decodable>(_ type: T.Type) throws -> T { try decodeScalar(type, from: value, at: codingPath) }
}
