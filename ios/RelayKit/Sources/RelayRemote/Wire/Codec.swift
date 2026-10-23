import Compression
import Foundation

public struct CodecError: Error, CustomStringConvertible {
    public let description: String
}

/// Raw DEFLATE, as fflate and node:zlib's `deflateRawSync` speak it. Apple's
/// zlib algorithm is exactly that: no header, no checksum.
public enum Codec {
    /// Above this it's photos, which barely shrink, at the phone's CPU.
    public static let deflateUpTo = 1024 * 1024
    public static let deflateFrom = 256
    public static let inflateCap = 32 * 1024 * 1024
    public static let maxFrameBytes = 16 * 1024 * 1024

    public static func deflate(_ bytes: Data) throws -> Data {
        try run(COMPRESSION_STREAM_ENCODE, bytes, cap: Int.max)
    }

    /// Throws on a truncated stream or one that grows past `cap`.
    public static func inflate(_ bytes: Data, cap: Int = inflateCap) throws -> Data {
        try run(COMPRESSION_STREAM_DECODE, bytes, cap: cap)
    }

    private static func run(_ operation: compression_stream_operation, _ input: Data, cap: Int) throws -> Data {
        let stream = UnsafeMutablePointer<compression_stream>.allocate(capacity: 1)
        defer { stream.deallocate() }
        guard compression_stream_init(stream, operation, COMPRESSION_ZLIB) == COMPRESSION_STATUS_OK else {
            throw CodecError(description: "Couldn't start zlib.")
        }
        defer { compression_stream_destroy(stream) }

        let chunk = 64 * 1024
        let buffer = UnsafeMutablePointer<UInt8>.allocate(capacity: chunk)
        defer { buffer.deallocate() }
        var out = Data()
        return try input.withUnsafeBytes { (raw: UnsafeRawBufferPointer) in
            stream.pointee.src_ptr = raw.bindMemory(to: UInt8.self).baseAddress ?? UnsafePointer(buffer)
            stream.pointee.src_size = raw.count
            while true {
                stream.pointee.dst_ptr = buffer
                stream.pointee.dst_size = chunk
                let status = compression_stream_process(stream, Int32(COMPRESSION_STREAM_FINALIZE.rawValue))
                let produced = chunk - stream.pointee.dst_size
                if out.count + produced > cap { throw CodecError(description: "Frame too large.") }
                out.append(buffer, count: produced)
                switch status {
                case COMPRESSION_STATUS_END: return out
                case COMPRESSION_STATUS_OK:
                    // Out of input with room left over and no end: the stream was cut short.
                    if produced == 0, stream.pointee.src_size == 0 {
                        throw CodecError(description: "Truncated frame.")
                    }
                default: throw CodecError(description: "Bad DEFLATE data.")
                }
            }
        }
    }
}
