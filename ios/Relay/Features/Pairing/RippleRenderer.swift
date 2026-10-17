import MetalKit
import os
import simd

private let rippleLog = Logger(subsystem: "dev.relay.ios", category: "ripples")

/// The field's colours: the theme's muted and accent, and the accent the scanner's dots take over the camera.
struct RipplePalette: Equatable {
    var base: SIMD3<Float>
    var hot: SIMD3<Float>
    var overCamera: SIMD3<Float>
    var baseAlpha: Float
}

/// What one frame draws.
struct RippleFrame {
    /// The field's own clock, which stands still under Reduce Motion.
    var time: Double
    /// The phone's tilt, -1...1 each way.
    var aim: SIMD2<Float>
    var scene: ScanScene
    /// Modules a side of the code being scanned, and the modules; 0 and empty before one's seen.
    var modules: Int
    /// The computer's answer goes out this frame.
    var answer: Bool
}

/// Laid out as Ripples.metal's FieldUniforms.
private struct FieldUniforms {
    var viewProjection: simd_float4x4
    var code: simd_float3x3
    var window: SIMD4<Float>
    var eye: SIMD3<Float>
    var base: SIMD3<Float>
    var hot: SIMD3<Float>
    var scan: SIMD3<Float>
    var screen: SIMD2<Float>
    var time: Float
    var px: Float
    var unit: Float
    var baseAlpha: Float
    var gather: Float
    var clear: Float
    var rest: Float
    var lock: Float
    var charge: Float
    var burst: Float
    var modules: Int32
}

/// Laid out as Ripples.metal's Glow.
private struct Glow {
    var clip: SIMD4<Float>
    var sizeAlpha: SIMD2<Float>
}

/// Draws the pairing screen's field, as the pairing-scan preview does: dots on a swelling floor,
/// calls going back and forth between the phone and the computer as rings and packets, and the
/// scan's fold, lock and burst on top.
final class RippleRenderer: NSObject, MTKViewDelegate {
    private let queue: MTLCommandQueue
    private let dots: MTLRenderPipelineState
    private let glows: MTLRenderPipelineState
    private var moduleBuffer: MTLBuffer
    private var moduleBytes: [UInt8] = []
    private var pulses: [SIMD4<Float>] = []
    private var last = -1.0
    private var seed: UInt64 = 7
    /// The calls back and forth start over after an answer, so none is in the air as it goes out.
    private var cycle0 = 0.0
    private var answeredAt = -Double.infinity
    /// The last frame's camera and clock, which a touch's ring starts from.
    private var shown: (viewProjection: simd_float4x4, eye: SIMD3<Float>, time: Double)?

    var palette: RipplePalette
    /// The frame to draw; nil skips one.
    var frame: () -> RippleFrame? = { nil }
    /// The modules of the code being scanned, row by row; set when one's read.
    var modules: [UInt8] = [] {
        didSet {
            guard modules != moduleBytes, !modules.isEmpty,
                let buffer = queue.device.makeBuffer(bytes: modules, length: modules.count)
            else { return }
            moduleBytes = modules
            moduleBuffer = buffer
        }
    }

    private static let cols = 72
    private static let rows = 112
    private static let slots = 24
    private static let fov: Float = 50
    /// The picture moved up the screen, so the field sits above the words.
    private static let shift: Float = 0.34
    private static let eye = SIMD3<Float>(0, 2.4, 7)
    private static let target = SIMD3<Float>(0, 0, -8)
    private static let phone = SIMD2<Float>(0, 6.5)
    static let computer = SIMD3<Float>(0, 0.05, -13)
    private static let others: [SIMD2<Float>] = [[-7, -11], [8, -17], [-3.5, -21], [5.5, -8]]
    private static let flight = 2.0
    private static let cycle = 2 * flight + 1.2
    private static let maxGlows = 72

    init?(view: MTKView, palette: RipplePalette) {
        guard let device = view.device, let queue = device.makeCommandQueue(), let library = device.makeDefaultLibrary(),
            let empty = device.makeBuffer(length: 4)
        else { return nil }
        self.queue = queue
        self.palette = palette
        moduleBuffer = empty
        do {
            func pipeline(_ vertex: String, _ fragment: String) throws -> MTLRenderPipelineState {
                let d = MTLRenderPipelineDescriptor()
                d.vertexFunction = library.makeFunction(name: vertex)
                d.fragmentFunction = library.makeFunction(name: fragment)
                let c = d.colorAttachments[0]!
                c.pixelFormat = view.colorPixelFormat
                c.isBlendingEnabled = true
                c.sourceRGBBlendFactor = .one
                c.sourceAlphaBlendFactor = .one
                c.destinationRGBBlendFactor = .oneMinusSourceAlpha
                c.destinationAlphaBlendFactor = .oneMinusSourceAlpha
                return try device.makeRenderPipelineState(descriptor: d)
            }
            dots = try pipeline("dotVertex", "dotFragment")
            glows = try pipeline("glowVertex", "glowFragment")
        } catch {
            rippleLog.error("Ripple pipelines failed: \(String(describing: error), privacy: .public)")
            return nil
        }
        super.init()
    }

    func mtkView(_ view: MTKView, drawableSizeWillChange size: CGSize) {}

    func draw(in view: MTKView) {
        let size = view.drawableSize
        guard size.width > 0, size.height > 0, view.bounds.width > 0, let f = frame(),
            let pass = view.currentRenderPassDescriptor, let commands = queue.makeCommandBuffer(),
            let encoder = commands.makeRenderCommandEncoder(descriptor: pass)
        else { return }
        let time = f.time
        if f.answer { answer(time) }
        schedule(time)

        let screen = SIMD2<Float>(Float(size.width), Float(size.height))
        let unit = Float(size.width / view.bounds.width)
        let eye = Self.orbit(Self.eye, Self.target, f.aim, 0.25, 0.12)
        let vp = Self.camera(eye: eye, target: Self.target, aspect: screen.x / screen.y)
        shown = (vp, eye, time)
        let px = screen.y / (2 * tan(Self.fov * .pi / 360))
        let s = f.scene
        let scanHot = simd_mix(palette.hot, palette.overCamera, SIMD3(repeating: s.covers))
        let phase = time >= cycle0 ? (time - cycle0).truncatingRemainder(dividingBy: Self.cycle) : -1

        // The computer, the other computers, and the calls between the phone and the computer.
        var lit: [Glow] = []
        func put(_ clip: SIMD4<Float>, _ size: Float, _ alpha: Float) {
            guard lit.count < Self.maxGlows, alpha > 0.002 else { return }
            lit.append(Glow(clip: clip, sizeAlpha: [size, alpha]))
        }
        func world(_ p: SIMD3<Float>, _ size: Float, _ alpha: Float) {
            let c = vp * SIMD4(p, 1)
            if c.w > 0.1 { put(c, min(500 * unit, size * px / c.w), alpha) }
        }
        let field = 1 - s.rest
        let answer = Float(exp(-(time - answeredAt) * 1.1))
        let flash = phase >= Self.flight ? Float(exp(-(phase - Self.flight) * 2.5)) : 0
        let bloom = max(flash, answer)
        world(Self.computer, 1.3 + flash + 3.2 * answer, (0.6 + 0.4 * bloom) * s.beacon)
        for o in Self.others { world([o.x, 0.05, o.y], 0.55, 0.22 * field) }

        var packets = [SIMD4<Float>](repeating: .zero, count: 2)
        func packet(_ start: Double, back: Bool) {
            let t = (phase - start) / Self.flight
            guard phase >= 0, t > 0, t < 1.12 else { return }
            if t < 1 {
                let p = Self.arc(Float(t * t * (3 - 2 * t)), back: back)
                packets[back ? 1 : 0] = [p.x, p.z, p.y, Float(sin(.pi * min(1, t * 1.1))) * field]
            }
            for k in 0..<26 {
                let at = t - Double(k) * 0.012
                guard at > 0, at < 1 else { continue }
                let eased = Float(at * at * (3 - 2 * at))
                let fall = 1 - Float(k) / 26
                world(Self.arc(eased, back: back), k == 0 ? 0.5 : 0.2 * fall, (k == 0 ? 1 : 0.55 * fall) * field)
            }
        }
        packet(0, back: false)
        packet(Self.flight + 0.6, back: true)

        if s.flash > 0 {
            let mid = s.code * SIMD3<Float>(0.5, 0.5, 1)
            let clip = SIMD4<Float>(mid.x / mid.z, mid.y / mid.z, 0, 1)
            put(clip, (260 + 420 * (1 - s.flash)) * unit, 0.35 * s.flash)
            put(clip, 110 * unit, s.flash)
        }

        var uniforms = FieldUniforms(
            viewProjection: vp, code: s.code, window: s.window, eye: eye, base: palette.base, hot: palette.hot,
            scan: scanHot, screen: screen, time: Float(time), px: px, unit: unit, baseAlpha: palette.baseAlpha,
            gather: s.gather, clear: s.clear, rest: s.rest, lock: s.lock, charge: s.charge, burst: s.burst,
            modules: Int32(moduleBytes.isEmpty ? 0 : f.modules))
        var waves = [SIMD4<Float>](repeating: .zero, count: Self.slots)
        for (i, p) in pulses.enumerated() { waves[i] = p }
        waves += packets

        encoder.setRenderPipelineState(dots)
        encoder.setVertexBytes(&uniforms, length: MemoryLayout<FieldUniforms>.stride, index: 0)
        encoder.setVertexBytes(waves, length: MemoryLayout<SIMD4<Float>>.stride * waves.count, index: 1)
        encoder.setVertexBuffer(moduleBuffer, offset: 0, index: 2)
        encoder.setFragmentBytes(&uniforms, length: MemoryLayout<FieldUniforms>.stride, index: 0)
        encoder.drawPrimitives(type: .triangleStrip, vertexStart: 0, vertexCount: 4, instanceCount: Self.cols * Self.rows)

        if !lit.isEmpty {
            var tint = SIMD4<Float>(s.flash > 0 ? simd_mix(scanHot, SIMD3(repeating: 1), SIMD3(repeating: 0.4)) : palette.hot, 1)
            var area = screen
            encoder.setRenderPipelineState(glows)
            encoder.setVertexBytes(lit, length: MemoryLayout<Glow>.stride * lit.count, index: 0)
            encoder.setVertexBytes(&tint, length: MemoryLayout<SIMD4<Float>>.stride, index: 1)
            encoder.setVertexBytes(&area, length: MemoryLayout<SIMD2<Float>>.stride, index: 2)
            encoder.drawPrimitives(type: .triangleStrip, vertexStart: 0, vertexCount: 4, instanceCount: lit.count)
        }
        encoder.endEncoding()
        guard let drawable = view.currentDrawable else { return }
        // The camera's window moves in the same transaction as this frame's dots.
        commands.commit()
        commands.waitUntilScheduled()
        drawable.present()
    }

    /// A ring from where a finger touched the floor, `point` in a view of `size`. False when it
    /// touched the sky above the field.
    func touch(at point: CGPoint, in size: CGSize, strength: Float) -> Bool {
        guard let shown, size.width > 0, size.height > 0 else { return false }
        let x = Float(point.x / size.width * 2 - 1), y = Float(1 - point.y / size.height * 2)
        let back = shown.viewProjection.inverse
        let a = back * SIMD4(x, y, 0, 1), b = back * SIMD4(x, y, 1, 1)
        let near = SIMD3(a.x, a.y, a.z) / a.w, far = SIMD3(b.x, b.y, b.z) / b.w
        let ray = far - near
        guard ray.y < -1e-4 else { return false }
        let hit = near + ray * (-near.y / ray.y)
        guard simd_distance(hit, shown.eye) < 34 else { return false }
        pulse(hit.x, hit.z, shown.time, strength)
        return true
    }

    /// The computer took the code: it flashes and its ring goes out across the field.
    private func answer(_ time: Double) {
        answeredAt = time
        cycle0 = time + 2.4
        pulse(Self.computer.x, Self.computer.z, time, 1.4)
    }

    private func random() -> Double {
        seed = (seed * 16807) % 2_147_483_647
        return Double(seed) / 2_147_483_647
    }

    private func pulse(_ x: Float, _ z: Float, _ t0: Double, _ strength: Float) {
        pulses.append([x, z, Float(t0), strength])
        if pulses.count > Self.slots { pulses.removeFirst() }
    }

    /// Fires whatever was due between the last frame and this one, at the time it was due.
    private func schedule(_ time: Double) {
        let from = last
        last = time
        func crossed(_ at: Double, _ every: Double) -> Double? {
            let k = floor((time - at) / every)
            return k >= 0 && at + k * every > from ? at + k * every : nil
        }
        let c = cycle0
        if let t = crossed(c, Self.cycle) { pulse(Self.phone.x, Self.phone.y, t, 0.45) }
        if let t = crossed(c + Self.flight, Self.cycle) { pulse(Self.computer.x, Self.computer.z, t, 1.15) }
        if let t = crossed(c + Self.flight + 0.6, Self.cycle) { pulse(Self.computer.x, Self.computer.z, t, 0.4) }
        if let t = crossed(c + 2 * Self.flight + 0.6, Self.cycle) { pulse(Self.phone.x, Self.phone.y, t, 1.0) }
        if let t = crossed(1.3, 2.9) {
            let o = Self.others[min(Self.others.count - 1, Int(random() * Double(Self.others.count)))]
            pulse(o.x, o.y, t, Float(0.3 + random() * 0.15))
        }
    }

    /// Where a packet is `s` of the way along its arc; the two directions bow to opposite sides.
    private static func arc(_ s: Float, back: Bool) -> SIMD3<Float> {
        let u = back ? 1 - s : s
        let side: Float = back ? -1 : 1
        return [
            phone.x + 1.6 * side * (1 - u) + 1.3 * side * sin(.pi * u),
            0.1 + 1.7 * sin(.pi * u),
            phone.y - 1.5 + (computer.z - phone.y + 1.5) * u,
        ]
    }

    /// Perspective from `eye` toward `target`, the picture moved up by `shift` without turning the camera.
    private static func camera(eye: SIMD3<Float>, target: SIMD3<Float>, aspect: Float) -> simd_float4x4 {
        let f = 1 / tan(fov * .pi / 360)
        let near: Float = 0.1, far: Float = 200
        let projection = simd_float4x4(columns: (
            [f / aspect, 0, 0, 0], [0, f, 0, 0], [0, 0, far / (near - far), -1], [0, 0, far * near / (near - far), 0]
        ))
        let z = simd_normalize(eye - target)
        let x = simd_normalize(simd_cross([0, 1, 0], z))
        let y = simd_cross(z, x)
        let view = simd_float4x4(columns: (
            [x.x, y.x, z.x, 0], [x.y, y.y, z.y, 0], [x.z, y.z, z.z, 0],
            [-simd_dot(x, eye), -simd_dot(y, eye), -simd_dot(z, eye), 1]
        ))
        var vp = projection * view
        for c in 0..<4 { vp[c][1] += shift * vp[c][3] }
        return vp
    }

    /// The eye swung around `target` by the tilt.
    private static func orbit(_ eye: SIMD3<Float>, _ target: SIMD3<Float>, _ aim: SIMD2<Float>, _ yawMax: Float, _ pitchMax: Float) -> SIMD3<Float> {
        let d = eye - target
        let yaw = aim.x * yawMax, pitch = aim.y * pitchMax
        let y1 = d.y * cos(pitch) - d.z * sin(pitch), z1 = d.y * sin(pitch) + d.z * cos(pitch)
        return [target.x + d.x * cos(yaw) + z1 * sin(yaw), target.y + y1, target.z - d.x * sin(yaw) + z1 * cos(yaw)]
    }
}
