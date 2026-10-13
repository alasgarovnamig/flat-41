package az.evtap.app.platform

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.media.ExifInterface
import android.net.Uri
import androidx.core.content.FileProvider
import az.evtap.core.api.ApiClient
import az.evtap.core.model.Upload
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.RequestBody
import okio.BufferedSink
import okio.source
import java.io.File
import java.util.UUID
import kotlin.math.max
import kotlin.math.roundToInt

/** Camera captures + downscaled JPEGs live in cache/camera (shared with the FileProvider, see res/xml/file_paths.xml). */
object ImageFiles {
    fun cacheDir(context: Context): File = File(context.cacheDir, "camera").apply { mkdirs() }

    /** A content:// URI the camera app can write to (ActivityResultContracts.TakePicture). */
    fun newCaptureUri(context: Context): Uri {
        val file = File(cacheDir(context), "capture_${UUID.randomUUID()}.jpg")
        return FileProvider.getUriForFile(context, "${context.packageName}.files", file)
    }
}

/**
 * Downscales a picked/captured image so the longest side is ≤ [maxSide] px, applies the EXIF rotation and writes a
 * JPEG (the server re-encodes to WebP + 400 px thumb). Keeps uploads small on mobile data.
 */
suspend fun downscaleToJpeg(context: Context, uri: Uri, maxSide: Int = 1600, quality: Int = 85): File = withContext(Dispatchers.IO) {
    val resolver = context.contentResolver
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    resolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) } ?: error("cannot open $uri")
    require(bounds.outWidth > 0 && bounds.outHeight > 0) { "not an image" }

    var sample = 1
    while (max(bounds.outWidth, bounds.outHeight) / (sample * 2) >= maxSide) sample *= 2
    val opts = BitmapFactory.Options().apply { inSampleSize = sample }
    var bmp = resolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, opts) } ?: error("decode failed")

    val longest = max(bmp.width, bmp.height)
    if (longest > maxSide) {
        val scale = maxSide.toFloat() / longest
        val scaled = Bitmap.createScaledBitmap(bmp, (bmp.width * scale).roundToInt(), (bmp.height * scale).roundToInt(), true)
        if (scaled !== bmp) bmp.recycle()
        bmp = scaled
    }

    val rotation = runCatching {
        resolver.openInputStream(uri)?.use { s ->
            when (ExifInterface(s).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)) {
                ExifInterface.ORIENTATION_ROTATE_90 -> 90f
                ExifInterface.ORIENTATION_ROTATE_180 -> 180f
                ExifInterface.ORIENTATION_ROTATE_270 -> 270f
                else -> 0f
            }
        } ?: 0f
    }.getOrDefault(0f)
    if (rotation != 0f) {
        val rotated = Bitmap.createBitmap(bmp, 0, 0, bmp.width, bmp.height, Matrix().apply { postRotate(rotation) }, true)
        if (rotated !== bmp) bmp.recycle()
        bmp = rotated
    }

    val out = File(ImageFiles.cacheDir(context), "upload_${UUID.randomUUID()}.jpg")
    out.outputStream().use { bmp.compress(Bitmap.CompressFormat.JPEG, quality, it) }
    bmp.recycle()
    out
}

/** Multipart body that reports upload progress (0..1) while OkHttp writes it. Re-readable for the 401 retry. */
private class ProgressRequestBody(
    private val file: File,
    private val contentType: MediaType,
    private val onProgress: (Float) -> Unit,
) : RequestBody() {
    override fun contentType(): MediaType = contentType
    override fun contentLength(): Long = file.length()

    override fun writeTo(sink: BufferedSink) {
        val total = contentLength().coerceAtLeast(1)
        var written = 0L
        file.source().use { source ->
            val buffer = okio.Buffer()
            while (true) {
                val read = source.read(buffer, 64 * 1024)
                if (read == -1L) break
                sink.write(buffer, read)
                written += read
                onProgress((written.toFloat() / total).coerceIn(0f, 1f))
            }
        }
    }
}

/** POST /uploads (multipart field "file"). */
suspend fun ApiClient.uploadImage(file: File, onProgress: (Float) -> Unit): Upload {
    val part = MultipartBody.Part.createFormData("file", file.name, ProgressRequestBody(file, "image/jpeg".toMediaType(), onProgress))
    return call { upload(part) }
}
