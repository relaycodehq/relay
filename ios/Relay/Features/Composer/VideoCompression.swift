@preconcurrency import AVFoundation
import Foundation

/// How a video a message takes along is made smaller: H.264 at most 720 on its short side, ~2.5
/// Mbps, at most 30 frames a second, its sound kept as AAC (Android's VideoCompression.kt).
private nonisolated enum Target {
    static let shortSide: CGFloat = 720
    static let bitRate = 2_500_000
    static let fps: Double = 30
    static let audioBitRate = 128_000
}

/// Writes `source` smaller to `target` (an .mp4); false when that came out no smaller, so the
/// original should go instead. Throws when the video can't be read.
@concurrent
nonisolated func compressVideo(_ source: URL, to target: URL) async throws -> Bool {
    let asset = AVURLAsset(url: source)
    guard let video = try await asset.loadTracks(withMediaType: .video).first else {
        throw PairingError("That video has no picture to send.")
    }
    let audio = try await asset.loadTracks(withMediaType: .audio).first
    let (natural, transform, rate) = try await video.load(.naturalSize, .preferredTransform, .nominalFrameRate)
    let factor = min(1, Target.shortSide / max(1, min(abs(natural.width), abs(natural.height))))
    // Encoders want even sides.
    let even = { (side: CGFloat) in max(2, Int((abs(side) * factor / 2).rounded()) * 2) }
    let width = even(natural.width), height = even(natural.height)

    try? FileManager.default.removeItem(at: target)
    let reader = try AVAssetReader(asset: asset)
    let writer = try AVAssetWriter(outputURL: target, fileType: .mp4)
    writer.shouldOptimizeForNetworkUse = true

    let videoOut = AVAssetReaderTrackOutput(
        track: video,
        outputSettings: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange])
    videoOut.alwaysCopiesSampleData = false
    reader.add(videoOut)
    let videoIn = AVAssetWriterInput(
        mediaType: .video,
        outputSettings: [
            AVVideoCodecKey: AVVideoCodecType.h264,
            AVVideoWidthKey: width,
            AVVideoHeightKey: height,
            AVVideoScalingModeKey: AVVideoScalingModeResizeAspect,
            // HDR from the camera comes out as plain colours; tag it so players agree.
            AVVideoColorPropertiesKey: [
                AVVideoColorPrimariesKey: AVVideoColorPrimaries_ITU_R_709_2,
                AVVideoTransferFunctionKey: AVVideoTransferFunction_ITU_R_709_2,
                AVVideoYCbCrMatrixKey: AVVideoYCbCrMatrix_ITU_R_709_2,
            ],
            AVVideoCompressionPropertiesKey: [
                AVVideoAverageBitRateKey: Target.bitRate,
                AVVideoExpectedSourceFrameRateKey: min(Double(rate > 0 ? rate : 30), Target.fps),
                AVVideoMaxKeyFrameIntervalKey: 60,
                AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel,
            ],
        ])
    videoIn.transform = transform
    videoIn.expectsMediaDataInRealTime = false
    writer.add(videoIn)

    var audioPair: (AVAssetReaderTrackOutput, AVAssetWriterInput)?
    if let audio {
        let format = try await audio.load(.formatDescriptions).first
        let source = format.flatMap { CMAudioFormatDescriptionGetStreamBasicDescription($0)?.pointee }
        let channels = min(2, max(1, Int(source?.mChannelsPerFrame ?? 2)))
        var layout = AudioChannelLayout()
        layout.mChannelLayoutTag = channels == 1 ? kAudioChannelLayoutTag_Mono : kAudioChannelLayoutTag_Stereo
        let layoutData = Data(bytes: &layout, count: MemoryLayout<AudioChannelLayout>.size)
        let out = AVAssetReaderTrackOutput(
            track: audio,
            outputSettings: [
                AVFormatIDKey: kAudioFormatLinearPCM, AVSampleRateKey: 44_100, AVNumberOfChannelsKey: channels,
                AVChannelLayoutKey: layoutData,
            ])
        let into = AVAssetWriterInput(
            mediaType: .audio,
            outputSettings: [
                AVFormatIDKey: kAudioFormatMPEG4AAC, AVSampleRateKey: 44_100, AVNumberOfChannelsKey: channels,
                AVChannelLayoutKey: layoutData, AVEncoderBitRateKey: Target.audioBitRate,
            ])
        into.expectsMediaDataInRealTime = false
        if reader.canAdd(out), writer.canAdd(into) {
            reader.add(out)
            writer.add(into)
            audioPair = (out, into)
        }
    }

    guard reader.startReading() else { throw reader.error ?? PairingError("Couldn't read that video.") }
    guard writer.startWriting() else { throw writer.error ?? PairingError("Couldn't make that video smaller.") }
    writer.startSession(atSourceTime: .zero)

    // Frames closer together than 30 a second are left out.
    let gap = CMTime(seconds: 1 / Target.fps - 0.002, preferredTimescale: 600)
    async let pictures: Void = pump(videoOut, into: videoIn, label: "video") { buffer, last in
        let at = CMSampleBufferGetPresentationTimeStamp(buffer)
        if let last, CMTimeCompare(CMTimeSubtract(at, last), gap) < 0 { return false }
        return true
    }
    async let sound: Void = {
        if let (out, into) = audioPair { await pump(out, into: into, label: "audio") { _, _ in true } }
    }()
    _ = await (pictures, sound)

    if reader.status == .failed || Task.isCancelled {
        writer.cancelWriting()
        try? FileManager.default.removeItem(at: target)
        if Task.isCancelled { throw CancellationError() }
        throw reader.error ?? PairingError("Couldn't read that video.")
    }
    await writer.finishWriting()
    guard writer.status == .completed else {
        try? FileManager.default.removeItem(at: target)
        throw writer.error ?? PairingError("Couldn't make that video smaller.")
    }
    let before = (try? source.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? .max
    let after = (try? target.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? .max
    if after >= before {
        try? FileManager.default.removeItem(at: target)
        return false
    }
    return true
}

/// Moves one track's samples from `output` into `input` as it's ready for them; `keep` may leave
/// some out, told the time of the last one kept.
private nonisolated func pump(
    _ output: AVAssetReaderTrackOutput, into input: AVAssetWriterInput, label: String,
    keep: @escaping @Sendable (CMSampleBuffer, CMTime?) -> Bool
) async {
    nonisolated(unsafe) let output = output
    nonisolated(unsafe) let input = input
    await withCheckedContinuation { (done: CheckedContinuation<Void, Never>) in
        nonisolated(unsafe) var last: CMTime?
        nonisolated(unsafe) var finished = false
        input.requestMediaDataWhenReady(on: DispatchQueue(label: "relay.compress.\(label)")) {
            while input.isReadyForMoreMediaData, !finished {
                guard let buffer = output.copyNextSampleBuffer() else {
                    finished = true
                    input.markAsFinished()
                    done.resume()
                    return
                }
                guard keep(buffer, last) else { continue }
                last = CMSampleBufferGetPresentationTimeStamp(buffer)
                if !input.append(buffer) {
                    finished = true
                    input.markAsFinished()
                    done.resume()
                    return
                }
            }
        }
    }
}
