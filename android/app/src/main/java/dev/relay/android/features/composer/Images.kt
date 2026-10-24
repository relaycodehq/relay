package dev.relay.android.features.composer

import android.Manifest
import android.content.ClipboardManager
import android.content.ContentValues
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.ImageDecoder
import android.net.Uri
import android.provider.MediaStore
import android.provider.OpenableColumns
import android.util.Base64
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import dev.relay.android.remote.model.PastedImage
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream
import kotlin.math.max
import kotlin.math.roundToInt

// mobile/src/remote/images.ts and ui/clipboard-image.ts.

/** A photo ready to send: the desktop takes JPEG, PNG or WebP data URLs up to 1.1 MB. */
data class Attachment(val uri: String, val name: String, val mimeType: String, val dataUrl: String, val id: String? = null) {
    fun pasted() = PastedImage(name, mimeType, dataUrl)
}

private const val MAX_CHARS = 1_100_000

/** Tried in turn until the photo fits: long side in pixels, JPEG quality. */
private val steps = listOf(1600 to 80, 1280 to 70, 1024 to 60, 800 to 50)

private fun displayName(context: Context, uri: Uri): String? = runCatching {
    context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use {
        if (it.moveToFirst()) it.getString(0) else null
    }
}.getOrNull()

/** Shrinks the photo until it fits a send; EXIF rotation is applied by the decoder. */
suspend fun prepareImage(context: Context, uri: Uri, fallbackName: String = "photo"): Attachment = withContext(Dispatchers.IO) {
    val name = (displayName(context, uri) ?: fallbackName).replace(Regex("\\.[^.]+$"), "").take(100) + ".jpg"
    val source = ImageDecoder.createSource(context.contentResolver, uri)
    for ((side, quality) in steps) {
        val bitmap = ImageDecoder.decodeBitmap(source) { decoder, info, _ ->
            val long = max(info.size.width, info.size.height)
            if (long > side) {
                val scale = side.toFloat() / long
                decoder.setTargetSize((info.size.width * scale).roundToInt().coerceAtLeast(1), (info.size.height * scale).roundToInt().coerceAtLeast(1))
            }
            decoder.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
        }
        val out = ByteArrayOutputStream()
        bitmap.compress(Bitmap.CompressFormat.JPEG, quality, out)
        bitmap.recycle()
        val dataUrl = "data:image/jpeg;base64," + Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
        if (dataUrl.length <= MAX_CHARS) return@withContext Attachment(uri.toString(), name, "image/jpeg", dataUrl)
    }
    throw IllegalStateException("That photo is too large to send.")
}

private fun clipboardImageUri(context: Context): Uri? {
    val clip = context.getSystemService(ClipboardManager::class.java)?.primaryClip ?: return null
    val description = clip.description
    for (i in 0 until clip.itemCount) {
        val uri = clip.getItemAt(i).uri ?: continue
        val type = context.contentResolver.getType(uri)
        if (type?.startsWith("image/") == true || description.hasMimeType("image/*")) return uri
    }
    return null
}

/** Whether the manifest asks for the camera: then the camera app may only open once it's granted. */
private fun declaresCamera(context: Context) = runCatching {
    @Suppress("DEPRECATION")
    context.packageManager.getPackageInfo(context.packageName, PackageManager.GET_PERMISSIONS)
        .requestedPermissions?.contains(Manifest.permission.CAMERA) == true
}.getOrDefault(false)

/** The composer's ways in for photos, videos and files: library, camera, clipboard, files. Results and failures go to the callbacks. */
class ImagePickers internal constructor(
    val library: () -> Unit,
    /** Any file, which goes as it is. */
    val files: () -> Unit,
    val camera: () -> Unit,
    val paste: () -> Unit,
    /** Images handed over by the keyboard or a paste into the text field. */
    val receive: (List<Uri>) -> Unit,
)

@Composable
fun rememberImagePickers(
    onPicked: (List<Attachment>) -> Unit,
    onError: (String) -> Unit,
    /** Videos (to compress) and files, which go by their path on the computer. */
    onFiles: (List<Uri>, video: Boolean) -> Unit,
): ImagePickers {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    fun prepareAll(uris: List<Uri>, name: String = "photo", after: () -> Unit = {}) {
        if (uris.isEmpty()) return after()
        scope.launch {
            try {
                onPicked(uris.map { prepareImage(context, it, name) })
            } catch (e: java.io.FileNotFoundException) {
                onError("That image isn't there anymore. Copy or pick it again.")
            } catch (e: SecurityException) {
                onError("Relay isn't allowed to read that image.")
            } catch (e: Exception) {
                onError(e.message ?: e.toString())
            } finally {
                after()
            }
        }
    }
    // Photos go as images, the agent sees them; videos go as files.
    val many = rememberLauncherForActivityResult(ActivityResultContracts.PickMultipleVisualMedia()) { picked ->
        val (videos, photos) = picked.partition { context.contentResolver.getType(it)?.startsWith("video/") == true }
        if (videos.isNotEmpty()) onFiles(videos, true)
        prepareAll(photos)
    }
    val documents = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { picked ->
        if (picked.isNotEmpty()) onFiles(picked, false)
    }
    var shot by remember { mutableStateOf<Uri?>(null) }
    val take = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { ok ->
        val uri = shot ?: return@rememberLauncherForActivityResult
        shot = null
        // The photo lives in the gallery only while it's read.
        val drop = { runCatching { context.contentResolver.delete(uri, null, null) }; Unit }
        if (ok) prepareAll(listOf(uri), "photo", drop) else drop()
    }
    fun openCamera() {
        val values = ContentValues().apply {
            put(MediaStore.Images.Media.DISPLAY_NAME, "relay-${System.currentTimeMillis()}.jpg")
            put(MediaStore.Images.Media.MIME_TYPE, "image/jpeg")
            put(MediaStore.Images.Media.IS_PENDING, 0)
        }
        val uri = runCatching { context.contentResolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values) }.getOrNull()
            ?: return onError("Couldn't open the camera.")
        shot = uri
        runCatching { take.launch(uri) }.onFailure {
            shot = null
            context.contentResolver.delete(uri, null, null)
            onError("Couldn't open the camera.")
        }
    }
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) openCamera() else onError("Relay needs the camera to take a photo.")
    }

    return ImagePickers(
        library = { many.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageAndVideo)) },
        files = {
            runCatching { documents.launch(arrayOf("*/*")) }.onFailure { onError("Couldn't open your files.") }
        },
        camera = {
            val needs = declaresCamera(context) &&
                ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED
            if (needs) permission.launch(Manifest.permission.CAMERA) else openCamera()
        },
        paste = {
            val uri = clipboardImageUri(context)
            if (uri == null) onError("There's no image to paste.") else prepareAll(listOf(uri), "pasted")
        },
        receive = { uris ->
            prepareAll(uris, "pasted")
        },
    )
}
