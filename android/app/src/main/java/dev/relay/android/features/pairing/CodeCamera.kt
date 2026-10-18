package dev.relay.android.features.pairing

import android.content.Context
import android.graphics.SurfaceTexture
import android.util.Log
import android.util.Size
import android.view.Surface
import androidx.camera.core.CameraSelector
import androidx.camera.core.ExperimentalGetImage
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.core.resolutionselector.AspectRatioStrategy
import androidx.camera.core.resolutionselector.ResolutionSelector
import androidx.camera.core.resolutionselector.ResolutionStrategy
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleOwner
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.barcode.BarcodeScannerOptions
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.common.InputImage
import io.nayuki.qrcodegen.QrCode
import io.nayuki.qrcodegen.QrSegment
import java.util.concurrent.Executors
import kotlin.math.max

/**
 * The back camera behind the field: its pictures go into the renderer's texture, which draws them
 * in dots, and it reports the first code it reads with the code's corners in the stage's pixels
 * (top left, top right, bottom right, bottom left), then follows those corners. Main thread.
 */
class CodeCamera(
    private val context: Context,
    private val owner: LifecycleOwner,
    private val texture: SurfaceTexture,
    /** Where the picture sits in the texture, once CameraX says. */
    private val laidOut: (PictureLayout) -> Unit,
) {
    /** Says whether the code is one to follow; a code it isn't, the camera doesn't report again. */
    var onSeen: (SeenCode, List<Vec2>) -> Boolean = { _, _ -> false }
    var onMoved: (List<Vec2>) -> Unit = {}
    var onFailed: () -> Unit = {}
    /** The stage's size in pixels; the picture fills it as a camera app's does. */
    var stage = Size(0, 0)

    private val main = ContextCompat.getMainExecutor(context)
    private val reading = Executors.newSingleThreadExecutor()
    private val scanner = BarcodeScanning.getClient(
        BarcodeScannerOptions.Builder().setBarcodeFormats(Barcode.FORMAT_QR_CODE).build(),
    )
    private var provider: ProcessCameraProvider? = null
    private var preview: Preview? = null
    private var analysis: ImageAnalysis? = null
    private var stopped = false
    private var followed: String? = null
    private val refused = HashSet<String>()

    fun start() {
        val future = ProcessCameraProvider.getInstance(context)
        future.addListener({
            if (stopped) return@addListener
            try {
                bind(future.get())
            } catch (e: Exception) {
                // No back camera (some Chromebooks), or it wouldn't open.
                Log.w(TAG, "The camera didn't start", e)
                onFailed()
            }
        }, main)
    }

    fun stop() {
        stopped = true
        val p = provider
        if (p != null) listOfNotNull(preview, analysis).forEach { runCatching { p.unbind(it) } }
        scanner.close()
        reading.shutdown()
    }

    private fun bind(p: ProcessCameraProvider) {
        provider = p
        val wide = AspectRatioStrategy.RATIO_16_9_FALLBACK_AUTO_STRATEGY
        val preview = Preview.Builder()
            .setResolutionSelector(
                ResolutionSelector.Builder().setAspectRatioStrategy(wide)
                    .setResolutionStrategy(ResolutionStrategy(Size(1920, 1080), ResolutionStrategy.FALLBACK_RULE_CLOSEST_LOWER_THEN_HIGHER))
                    .build(),
            )
            .build()
        preview.setSurfaceProvider(main) { request ->
            val size = request.resolution
            texture.setDefaultBufferSize(size.width, size.height)
            val surface = Surface(texture)
            request.setTransformationInfoListener(main) { info ->
                // Rotated as a whole, the picture's upright; the texture's transform may carry part of it.
                val upright = info.rotationDegrees % 180 == 90
                val display = when (context.display.rotation) {
                    Surface.ROTATION_90 -> 90
                    Surface.ROTATION_180 -> 180
                    Surface.ROTATION_270 -> 270
                    else -> 0
                }
                laidOut(
                    PictureLayout(
                        width = if (upright) size.height else size.width,
                        height = if (upright) size.width else size.height,
                        rotation = if (info.hasCameraTransform()) display else info.rotationDegrees,
                    ),
                )
            }
            request.provideSurface(surface, main) { surface.release() }
        }
        val analysis = ImageAnalysis.Builder()
            .setResolutionSelector(
                ResolutionSelector.Builder().setAspectRatioStrategy(wide)
                    .setResolutionStrategy(ResolutionStrategy(Size(1280, 720), ResolutionStrategy.FALLBACK_RULE_CLOSEST_HIGHER_THEN_LOWER))
                    .build(),
            )
            .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
            .build()
        analysis.setAnalyzer(reading) { read(it) }
        this.preview = preview
        this.analysis = analysis
        p.bindToLifecycle(owner, CameraSelector.DEFAULT_BACK_CAMERA, preview, analysis)
    }

    @androidx.annotation.OptIn(ExperimentalGetImage::class)
    private fun read(proxy: ImageProxy) {
        val media = proxy.image ?: return proxy.close()
        val rotation = proxy.imageInfo.rotationDegrees
        val image = if (rotation % 180 == 90) Size(proxy.height, proxy.width) else Size(proxy.width, proxy.height)
        scanner.process(InputImage.fromMediaImage(media, rotation))
            .addOnSuccessListener(main) { codes ->
                codes.firstOrNull { it.rawValue != null && it.cornerPoints?.size == 4 }?.let { sighted(it, image) }
            }
            .addOnCompleteListener { proxy.close() }
    }

    private fun sighted(code: Barcode, image: Size) {
        val text = code.rawValue ?: return
        if (stopped || text in refused || stage.width == 0) return
        val corners = code.cornerPoints!!.map { onStage(it.x.toFloat(), it.y.toFloat(), image, stage) }
        if (followed != null) {
            if (followed == text) onMoved(corners)
            return
        }
        val modules = CodeModules.read(text)
        if (onSeen(SeenCode(text, modules.first, modules.second), corners)) followed = text else refused += text
    }

    private companion object {
        const val TAG = "RelayPair"

        /** Where a pixel of the upright picture shows on a stage the picture fills. */
        fun onStage(x: Float, y: Float, image: Size, stage: Size): Vec2 {
            val s = max(stage.width / image.width.toFloat(), stage.height / image.height.toFloat())
            return Vec2((x - image.width / 2f) * s + stage.width / 2f, (y - image.height / 2f) * s + stage.height / 2f)
        }
    }
}

/**
 * The code's modules, drawn again from its text the way the desktop draws it (uqr: ECC M, no
 * boost, its own choice of mask), so the dots lock onto the very modules the camera saw.
 */
object CodeModules {
    fun read(text: String): Pair<Int, ByteArray> = runCatching {
        val qr = QrCode.encodeSegments(QrSegment.makeSegments(text), QrCode.Ecc.MEDIUM, 1, 40, -1, false)
        val n = qr.size
        n to ByteArray(n * n) { if (qr.getModule(it % n, it / n)) 1 else 0 }
    }.getOrElse { 0 to ByteArray(0) }
}
