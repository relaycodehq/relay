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
    /// The camera's dots are dark on light, like ink.
    var light: Bool
}

/// What one frame draws.
struct RippleFrame {
    /// The field's own clock, which stands still under Reduce Motion.
    var time: Double
    var scene: ScanScene
    /// Modules a side of the code being scanned, and the modules; 0 and empty before one's seen.
    var modules: Int
    /// The computer's answer goes out this frame.
    var answer: Bool
    /// The camera's newest picture, while it's wanted.
    var camera: CameraFrame?
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
    var front: Float
    var entering: Float
    var develop: Float
    var turn: Float
    var glow: Float
}

/// Laid out as Ripples.metal's CameraUniforms.
private struct CameraUniforms {
    var uncode: simd_float3x3
    var window: SIMD4<Float>
    var accent: SIMD3<Float>
    var screen: SIMD2<Float>
    var fill: SIMD2<Float>
    var unit: Float
    var front: Float
    var entrance: Float
    var alpha: Float
    var shade: Float
    var lifted: Float
    var light: Float
    var develop: Float
}

/// Laid out as Ripples.metal's Beacon.
private struct Beacon {
    var alpha: Float
    var bloom: Float
    var y: Float
}

/// Laid out as Ripples.metal's Glow.
private struct Glow {
    var clip: SIMD4<Float>
    var sizeAlpha: SIMD2<Float>
}

/// Draws the pairing screen's field, as the pairing-scan preview does: dots on a swelling floor,
/// calls going back and forth between the phone and the computer as rings and packets, and the
/// scan's camera in dots under it, with the lock and burst on top.
final class RippleRenderer: NSObject, MTKViewDelegate {
    private let queue: MTLCommandQueue
    private let dots: MTLRenderPipelineState
    private let glows: MTLRenderPipelineState
    private let beacon: MTLRenderPipelineState
    private let picture: MTLRenderPipelineState
    /// What the camera shows before its first picture.
    private let black: MTLTexture
    private var moduleBuffer: MTLBuffer
    private var moduleBytes: [UInt8] = []
    private var pulses: [SIMD4<Float>] = []
    private var last = -1.0
    private var seed: UInt64 = 7
    /// The calls back and forth start over after an answer, so none is in the air as it goes out.
    private var cycle0 = 0.0
    private var answeredAt = -Double.infinity
    /// The last frame's camera and clock, which a touch's ring starts from.
    /// How far the view has turned round the computer, radians.
    private var yaw: Float = 0
    /// The turn the field's dots were given their places in the viewfinder at, kept from the start
    /// of a scan through its burst so none swaps place mid-flight.
    private var scanYaw: Float = 0
    private var lastGather: Float = 0
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

    /// As Ripples.metal's COLS, ROWS and SPECKS.
    private static let cols = 118
    private static let rows = 140
    private static let specks = 24
    private static let beaconSpecks = 3000
    /// Specks a draw.
    private static let batch = 32768
    private static let slots = 24
    private static let fov: Float = 50
    /// The picture moved up the screen, so the field sits above the words.
    private static let shift: Float = 0.34
    private static let eye = SIMD3<Float>(0, 2.4, 7)
    private static let target = SIMD3<Float>(0, 0, -8)
    private static let phone = SIMD2<Float>(0, 6.5)
    /// Seconds for the view to go once round the computer.
    private static let turnSeconds = 90.0
    static let computer = SIMD3<Float>(0, 0.05, -13)
    private static let others: [SIMD2<Float>] = [[-7, -11], [8, -17], [-3.5, -21], [5.5, -8]]
    private static let flight = 2.0
    private static let cycle = 2 * flight + 1.2
    private static let maxGlows = 72

    init?(view: MTKView, palette: RipplePalette) {
        let blank = MTLTextureDescriptor.texture2DDescriptor(pixelFormat: .bgra8Unorm, width: 1, height: 1, mipmapped: false)
        guard let device = view.device, let queue = device.makeCommandQueue(), let library = device.makeDefaultLibrary(),
            let empty = device.makeBuffer(length: 4), let black = device.makeTexture(descriptor: blank)
        else { return nil }
        black.replace(region: MTLRegionMake2D(0, 0, 1, 1), mipmapLevel: 0, withBytes: [UInt8](arrayLiteral: 0, 0, 0, 255), bytesPerRow: 4)
        self.black = black
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
            beacon = try pipeline("beaconVertex", "dotFragment")
            picture = try pipeline("cameraVertex", "cameraFragment")
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
        // The view turns slowly round the computer on the field's clock; eye and aim turn together,
        // so the framing holds.
        yaw = Float((time / Self.turnSeconds).truncatingRemainder(dividingBy: 1) * 2 * .pi)
        let eye = turn(Self.eye)
        let vp = Self.camera(eye: eye, target: turn(Self.target), aspect: screen.x / screen.y)
        shown = (vp, eye, time)
        let px = screen.y / (2 * tan(Self.fov * .pi / 360))
        let s = f.scene
        if s.gather > 0, lastGather == 0 { scanYaw = yaw }
        lastGather = s.gather
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
        let beaconY = beaconHeight(Float(time))
        var lights = Beacon(alpha: s.beacon, bloom: bloom, y: beaconY)
        for o in Self.others { world([o.x, 0.05, o.y], 0.55, 0.22 * field) }

        var packets = [SIMD4<Float>](repeating: .zero, count: 2)
        func packet(_ start: Double, back: Bool) {
            let t = (phase - start) / Self.flight
            guard phase >= 0, t > 0, t < 1.12 else { return }
            if t < 1 {
                let p = arc(Float(t * t * (3 - 2 * t)), back: back, to: beaconY)
                packets[back ? 1 : 0] = [p.x, p.z, p.y, Float(sin(.pi * min(1, t * 1.1))) * field]
            }
            for k in 0..<26 {
                let at = t - Double(k) * 0.012
                guard at > 0, at < 1 else { continue }
                let eased = Float(at * at * (3 - 2 * at))
                let fall = 1 - Float(k) / 26
                world(arc(eased, back: back, to: beaconY), k == 0 ? 0.5 : 0.2 * fall, (k == 0 ? 1 : 0.55 * fall) * field)
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
            modules: Int32(moduleBytes.isEmpty ? 0 : f.modules), front: s.front, entering: s.entering ? 1 : 0,
            develop: s.develop, turn: scanYaw, glow: palette.light ? 0 : 1)
        var waves = [SIMD4<Float>](repeating: .zero, count: Self.slots)
        for (i, p) in pulses.enumerated() { waves[i] = p }
        waves += packets

        if s.camera, s.cameraAlpha > 0 {
            let texture = f.camera?.texture ?? black
            // Filled as a camera app's preview is: cropped to the screen, never letterboxed.
            let image = SIMD2<Float>(Float(texture.width), Float(texture.height))
            let fill = screen / (image * max(screen.x / image.x, screen.y / image.y))
            var camera = CameraUniforms(
                uncode: s.code.inverse, window: s.window, accent: scanHot, screen: screen, fill: fill, unit: unit,
                front: s.front, entrance: s.entrance, alpha: s.cameraAlpha, shade: s.shade,
                lifted: s.lifted ? 1 : 0, light: palette.light ? 1 : 0,
                develop: s.develop)
            encoder.setRenderPipelineState(picture)
            encoder.setFragmentBytes(&camera, length: MemoryLayout<CameraUniforms>.stride, index: 0)
            encoder.setFragmentTexture(texture, index: 0)
            encoder.drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: 3)
            // The picture's buffer goes back to the camera only once the GPU is done with it.
            if let held = f.camera { commands.addCompletedHandler { _ in withExtendedLifetime(held) {} } }
        }

        encoder.setRenderPipelineState(dots)
        encoder.setVertexBytes(&uniforms, length: MemoryLayout<FieldUniforms>.stride, index: 0)
        encoder.setVertexBytes(waves, length: MemoryLayout<SIMD4<Float>>.stride * waves.count, index: 1)
        encoder.setVertexBuffer(moduleBuffer, offset: 0, index: 2)
        encoder.setFragmentBytes(&uniforms, length: MemoryLayout<FieldUniforms>.stride, index: 0)
        let specks = Self.cols * Self.rows * Self.specks
        for start in stride(from: 0, to: specks, by: Self.batch) {
            encoder.drawPrimitives(type: .point, vertexStart: start, vertexCount: min(Self.batch, specks - start))
        }

        if lights.alpha > 0.002 {
            encoder.setRenderPipelineState(beacon)
            encoder.setVertexBytes(&lights, length: MemoryLayout<Beacon>.stride, index: 2)
            encoder.drawPrimitives(type: .point, vertexStart: 0, vertexCount: Self.beaconSpecks)
        }

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
        commands.present(drawable)
        commands.commit()
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
        let phone = turn([Self.phone.x, 0, Self.phone.y])
        if let t = crossed(c, Self.cycle) { pulse(phone.x, phone.z, t, 0.45) }
        if let t = crossed(c + Self.flight, Self.cycle) { pulse(Self.computer.x, Self.computer.z, t, 1.15) }
        if let t = crossed(c + Self.flight + 0.6, Self.cycle) { pulse(Self.computer.x, Self.computer.z, t, 0.4) }
        if let t = crossed(c + 2 * Self.flight + 0.6, Self.cycle) { pulse(phone.x, phone.z, t, 1.0) }
        if let t = crossed(1.3, 2.9) {
            let o = Self.others[min(Self.others.count - 1, Int(random() * Double(Self.others.count)))]
            pulse(o.x, o.y, t, Float(0.3 + random() * 0.15))
        }
    }

    /// Where a packet is `s` of the way along its arc; the two directions bow to opposite sides.
    /// Its computer end steers to the computer's height `to`, wherever the field has carried it.
    private func arc(_ s: Float, back: Bool, to: Float) -> SIMD3<Float> {
        let u = back ? 1 - s : s
        let side: Float = back ? -1 : 1
        let phone = Self.phone, computer = Self.computer
        return turn([
            phone.x + 1.6 * side * (1 - u) + 1.3 * side * sin(.pi * u),
            0.1 + 1.7 * sin(.pi * u) + (to - 0.1) * u * u * (3 - 2 * u),
            phone.y - 1.5 + (computer.z - phone.y + 1.5) * u,
        ])
    }

    /// How high the computer floats: on the swell, lifted by the rings under it, as Ripples.metal's
    /// swellAt and ringsAt have the field at its foot.
    private func beaconHeight(_ time: Float) -> Float {
        let x = Self.computer.x, z = Self.computer.z
        let swell = 0.11 * sin(x * 0.55 + time * 0.6) * cos(z * 0.42 - time * 0.45)
            + 0.05 * sin(z * 0.9 + x * 0.2 + time * 0.8)
        var lift: Float = 0, wash: Float = 0
        for p in pulses {
            let age = time - p.z
            guard age >= 0, p.w > 0 else { continue }
            let ring = simd_distance(SIMD2(x, z), SIMD2(p.x, p.y)) - age * 3.4
            let fade = p.w * exp(-age * 0.28)
            lift += fade * exp(-ring * ring / (0.12 + age * 0.06))
            if ring <= 0 { wash += fade * exp(ring / 1.6) * exp(-age * 0.9) * 0.5 }
        }
        return 0.32 + swell + 0.5 * lift + 0.08 * wash
    }

    /// A point on your side of the field carried round the computer as far as the view has turned.
    private func turn(_ p: SIMD3<Float>) -> SIMD3<Float> {
        let d = p - Self.computer
        return [Self.computer.x + d.x * cos(yaw) + d.z * sin(yaw), p.y, Self.computer.z - d.x * sin(yaw) + d.z * cos(yaw)]
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

}
