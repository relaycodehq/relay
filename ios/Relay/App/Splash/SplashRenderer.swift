import MetalKit
import os
import simd

private let splashLog = Logger(subsystem: "dev.relay.ios", category: "splash")

/// Where the launch screen drew its still, in the overlay's pixels.
struct IconSpot {
    var center: SIMD2<Double>
    var size: Double
}

/// The ribbon pass's uniforms, laid out as Splash.metal's RibbonUniforms.
private struct RibbonUniforms {
    var viewProjection: simd_float4x4
    var camera: SIMD3<Float>
    var span: Float
    var lightBackground: Int32
    var mode: Int32
}

/// The backdrop pass's uniforms, laid out as Splash.metal's BackdropUniforms.
private struct BackdropUniforms {
    var background: SIMD3<Float>
    var alpha: Float
    var resolution: SIMD2<Float>
}

/// Draws the pull, as Android's SplashRenderer does. Its first frames are the still the launch
/// screen showed, so the still under it can go unseen; `onCovering` says when.
final class SplashRenderer: NSObject, MTKViewDelegate {
    private let device: MTLDevice
    private let queue: MTLCommandQueue
    private let ribbon: MTLRenderPipelineState
    private let wakePipeline: MTLRenderPipelineState
    private let backdrop: MTLRenderPipelineState
    private let depthOn: MTLDepthStencilState
    private let depthOff: MTLDepthStencilState
    private let background: SIMD3<Float>
    private let spot: () -> IconSpot
    private var mask: MTLTexture?
    private var maskCleared = false
    private var frames = 0
    private var start: CFTimeInterval = 0

    var onCovering: () -> Void = {}
    var onFrame: (PullFrame) -> Void = { _ in }

    private static let samples = 1800
    private static let wakeSamples = 900
    // Its soft edges eat into it, so a little wider cuts the splash as wide as the ribbon.
    private static let wakeWidth = 1.4
    private static let floats = 13
    private static let mainWidths = widths(samples)
    private static let wakeWidths = widths(wakeSamples)

    /// Nil where there's no Metal or the shaders don't build: the splash gives way to the app.
    init?(view: MTKView, background: SIMD3<Float>, spot: @escaping () -> IconSpot) {
        guard let device = view.device ?? MTLCreateSystemDefaultDevice(), let queue = device.makeCommandQueue(),
            let library = device.makeDefaultLibrary()
        else { return nil }
        self.device = device
        self.queue = queue
        self.background = background
        self.spot = spot
        do {
            let main = MTLRenderPipelineDescriptor()
            main.vertexFunction = library.makeFunction(name: "ribbonVertex")
            main.fragmentFunction = library.makeFunction(name: "ribbonFragment")
            main.colorAttachments[0].pixelFormat = view.colorPixelFormat
            main.depthAttachmentPixelFormat = view.depthStencilPixelFormat
            main.rasterSampleCount = view.sampleCount
            ribbon = try device.makeRenderPipelineState(descriptor: main)

            let wake = MTLRenderPipelineDescriptor()
            wake.vertexFunction = main.vertexFunction
            wake.fragmentFunction = main.fragmentFunction
            wake.colorAttachments[0].pixelFormat = .rgba8Unorm
            wake.colorAttachments[0].isBlendingEnabled = true
            wake.colorAttachments[0].rgbBlendOperation = .max
            wake.colorAttachments[0].alphaBlendOperation = .max
            for factor in [\MTLRenderPipelineColorAttachmentDescriptor.sourceRGBBlendFactor, \.sourceAlphaBlendFactor,
                \.destinationRGBBlendFactor, \.destinationAlphaBlendFactor]
            {
                wake.colorAttachments[0][keyPath: factor] = .one
            }
            wakePipeline = try device.makeRenderPipelineState(descriptor: wake)

            let back = MTLRenderPipelineDescriptor()
            back.vertexFunction = library.makeFunction(name: "backdropVertex")
            back.fragmentFunction = library.makeFunction(name: "backdropFragment")
            back.colorAttachments[0].pixelFormat = view.colorPixelFormat
            back.colorAttachments[0].isBlendingEnabled = true
            back.colorAttachments[0].sourceRGBBlendFactor = .one
            back.colorAttachments[0].sourceAlphaBlendFactor = .one
            back.colorAttachments[0].destinationRGBBlendFactor = .oneMinusSourceAlpha
            back.colorAttachments[0].destinationAlphaBlendFactor = .oneMinusSourceAlpha
            back.depthAttachmentPixelFormat = view.depthStencilPixelFormat
            back.rasterSampleCount = view.sampleCount
            backdrop = try device.makeRenderPipelineState(descriptor: back)
        } catch {
            splashLog.error("Splash pipelines failed: \(String(describing: error), privacy: .public)")
            return nil
        }
        let on = MTLDepthStencilDescriptor()
        on.depthCompareFunction = .lessEqual
        on.isDepthWriteEnabled = true
        let off = MTLDepthStencilDescriptor()
        guard let depthOn = device.makeDepthStencilState(descriptor: on),
            let depthOff = device.makeDepthStencilState(descriptor: off)
        else { return nil }
        self.depthOn = depthOn
        self.depthOff = depthOff
        super.init()
    }

    func mtkView(_ view: MTKView, drawableSizeWillChange size: CGSize) {
        mask = nil
    }

    func draw(in view: MTKView) {
        // The still for two frames, so it's on screen before the still under it goes.
        frames += 1
        if frames == 2 { onCovering() }
        if frames == 3 { start = CACurrentMediaTime() }
        let frame = PullSplash.frame(frames < 3 ? 0 : CACurrentMediaTime() - start)

        let size = view.drawableSize
        guard size.width > 0, size.height > 0, let commands = queue.makeCommandBuffer() else { return }
        let viewProjection = Self.viewProjection(size, spot())
        if mask == nil { mask = makeMask(size) }

        if frame.ribbon && frame.wake, let mask, let strip = build(frame.tail, Self.wakeSamples, Self.wakeWidth) {
            let pass = MTLRenderPassDescriptor()
            pass.colorAttachments[0].texture = mask
            pass.colorAttachments[0].loadAction = maskCleared ? .load : .clear
            pass.colorAttachments[0].clearColor = MTLClearColor(red: 0, green: 0, blue: 0, alpha: 0)
            pass.colorAttachments[0].storeAction = .store
            maskCleared = true
            if let encoder = commands.makeRenderCommandEncoder(descriptor: pass) {
                encoder.setRenderPipelineState(wakePipeline)
                drawRibbon(encoder, strip, viewProjection, mode: 1)
                encoder.endEncoding()
            }
        }

        guard let pass = view.currentRenderPassDescriptor, let drawable = view.currentDrawable,
            let encoder = commands.makeRenderCommandEncoder(descriptor: pass)
        else { return }
        // Never drawn into before the wake starts: the backdrop is whole.
        if let texture = maskCleared ? mask : blank {
            encoder.setRenderPipelineState(backdrop)
            encoder.setDepthStencilState(depthOff)
            var uniforms = BackdropUniforms(
                background: background, alpha: frame.backdrop,
                resolution: [Float(size.width), Float(size.height)])
            encoder.setFragmentBytes(&uniforms, length: MemoryLayout<BackdropUniforms>.stride, index: 0)
            encoder.setFragmentTexture(texture, index: 0)
            encoder.drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: 3)
        }
        if frame.ribbon, let strip = build(frame.tail, Self.samples, 1) {
            encoder.setRenderPipelineState(ribbon)
            encoder.setDepthStencilState(depthOn)
            drawRibbon(encoder, strip, viewProjection, mode: 0)
        }
        encoder.endEncoding()
        commands.present(drawable)
        commands.commit()
        onFrame(frame)
    }

    /// A 1×1 clear texture, for the backdrop before the wake has drawn its mask.
    private lazy var blank: MTLTexture? = {
        let d = MTLTextureDescriptor.texture2DDescriptor(pixelFormat: .rgba8Unorm, width: 1, height: 1, mipmapped: false)
        let texture = device.makeTexture(descriptor: d)
        var zero: UInt32 = 0
        texture?.replace(region: MTLRegionMake2D(0, 0, 1, 1), mipmapLevel: 0, withBytes: &zero, bytesPerRow: 4)
        return texture
    }()

    /// The wake's mask, at half the screen's resolution.
    private func makeMask(_ size: CGSize) -> MTLTexture? {
        let d = MTLTextureDescriptor.texture2DDescriptor(
            pixelFormat: .rgba8Unorm, width: max(1, Int(size.width) / 2), height: max(1, Int(size.height) / 2),
            mipmapped: false)
        d.usage = [.renderTarget, .shaderRead]
        d.storageMode = .private
        maskCleared = false
        return device.makeTexture(descriptor: d)
    }

    private func drawRibbon(_ encoder: MTLRenderCommandEncoder, _ strip: MTLBuffer, _ vp: simd_float4x4, mode: Int32) {
        var uniforms = RibbonUniforms(
            viewProjection: vp, camera: [0, 0, Float(PullSplash.cameraDistance)], span: Float(PullSplash.span),
            lightBackground: background.x > 0.5 ? 1 : 0, mode: mode)
        encoder.setVertexBuffer(strip, offset: 0, index: 0)
        encoder.setVertexBytes(&uniforms, length: MemoryLayout<RibbonUniforms>.stride, index: 1)
        encoder.setFragmentBytes(&uniforms, length: MemoryLayout<RibbonUniforms>.stride, index: 1)
        encoder.drawPrimitives(type: .triangleStrip, vertexStart: 0, vertexCount: strip.length / (Self.floats * 4))
    }

    /// The strip for the ribbon whose tail is at `tail`; `scale` widens it (the wake is a little wider).
    private func build(_ tail: Double, _ samples: Int, _ scale: Double) -> MTLBuffer? {
        let guide = PullSplash.guide
        let span = PullSplash.span
        let widths = samples == Self.samples ? Self.mainWidths : Self.wakeWidths
        let count = samples * 2 * Self.floats
        // A fresh buffer each frame, so the GPU never reads one that's being written.
        guard let buffer = device.makeBuffer(length: count * 4, options: .storageModeShared) else { return nil }
        let out = buffer.contents().bindMemory(to: Float.self, capacity: count)
        var o = 0
        func put(_ v: SIMD3<Double>) {
            out[o] = Float(v.x)
            out[o + 1] = Float(v.y)
            out[o + 2] = Float(v.z)
            o += 3
        }
        func put(_ v: Double) {
            out[o] = Float(v)
            o += 1
        }
        for i in 0..<samples {
            let s = Double(i) / Double(samples - 1)
            let u = tail + s * span
            let g = guide.sample(u)
            let w = widths[i] * scale * g.boost
            let n0 = simd_cross(g.t, g.b)
            let across = g.b * cos(g.twist) + n0 * sin(g.twist)
            let normal = simd_cross(g.t, across)
            for side in 0...1 {
                put(g.p + across * ((Double(side) - 0.5) * w))
                put(normal)
                put(g.t)
                put(s)
                put(Double(side))
                put(1)
                put(w)
            }
        }
        return buffer
    }

    private static func widths(_ samples: Int) -> [Double] {
        (0..<samples).map { RelayR.width(at: Double($0) / Double(samples - 1)) }
    }

    /// A camera `PullSplash.cameraDistance` away looking at the R, its lens shifted and its angle
    /// chosen so the R lands on the launch still at the still's scale. Metal's depth runs 0…1.
    private static func viewProjection(_ size: CGSize, _ icon: IconSpot) -> simd_float4x4 {
        let w = Double(size.width), h = Double(size.height)
        let d = PullSplash.cameraDistance
        let unit = icon.size * PullSplash.unitPixels / PullSplash.iconPixels
        let fy = 2 * d * unit / h
        let fx = 2 * d * unit / w
        let shiftX = (icon.center.x - w / 2) / (w / 2)
        let shiftY = (h / 2 - icon.center.y) / (h / 2)
        let near = 0.01, far = 500.0
        let a = far / (near - far)
        let b = far * near / (near - far)
        return simd_float4x4(
            SIMD4(Float(fx), 0, 0, 0),
            SIMD4(0, Float(fy), 0, 0),
            SIMD4(Float(-shiftX), Float(-shiftY), Float(a), -1),
            SIMD4(Float(shiftX * d), Float(shiftY * d), Float(a * -d + b), Float(d)))
    }
}
