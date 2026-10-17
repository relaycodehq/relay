/// An optional field that reads as nil when it doesn't decode, so one malformed part (an old
/// thread's last input without a `choice`) doesn't keep the rest from loading.
@propertyWrapper
public struct Lenient<Value: Codable & Sendable & Equatable>: Codable, Sendable, Equatable {
    public var wrappedValue: Value?

    public init(wrappedValue: Value?) { self.wrappedValue = wrappedValue }

    public init(from decoder: Decoder) throws {
        wrappedValue = try? decoder.singleValueContainer().decode(Value.self)
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        if let wrappedValue { try c.encode(wrappedValue) } else { try c.encodeNil() }
    }
}

extension KeyedDecodingContainer {
    /// A missing key is nil too, as it is for a plain optional.
    public func decode<Value>(_ type: Lenient<Value>.Type, forKey key: Key) throws -> Lenient<Value> {
        Lenient(wrappedValue: (try? decodeIfPresent(Value.self, forKey: key)) ?? nil)
    }
}

extension KeyedEncodingContainer {
    /// Left out when nil, as a plain optional is.
    public mutating func encode<Value>(_ value: Lenient<Value>, forKey key: Key) throws {
        try encodeIfPresent(value.wrappedValue, forKey: key)
    }
}
