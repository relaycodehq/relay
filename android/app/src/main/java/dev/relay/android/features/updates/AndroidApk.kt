package dev.relay.android.features.updates

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.net.ConnectivityManager
import android.os.Build
import android.provider.Settings
import androidx.core.net.toUri
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.ProcessLifecycleOwner
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.security.MessageDigest
import java.util.Base64
import java.util.concurrent.TimeUnit

class ApkException(message: String) : Exception(message)

/**
 * The Android half of the installer (mobile/modules/relay-apk): downloads into
 * cacheDir/apk with the feed's SHA-512, checks the file is this app at the
 * offered version, and commits a PackageInstaller session. Android only
 * accepts an update signed with the installed app's key; the checksum catches
 * a wrong or damaged file before that.
 */
class AndroidApk(private val context: Context, private val http: OkHttpClient) : ApkNative {
    private val dir get() = File(context.cacheDir, "apk")

    /** The update this app came up from has done its job. */
    fun dropInstalled(installed: String) {
        File(dir, "Relay-$installed.apk").delete()
    }

    override fun canInstall() = context.packageManager.canRequestPackageInstalls()

    override fun allowInstalls() {
        val intent = Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, "package:${context.packageName}".toUri())
        context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }

    override fun metered(): Boolean? =
        (context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager)?.isActiveNetworkMetered

    override fun openUrl(url: String) {
        context.startActivity(Intent(Intent.ACTION_VIEW, url.toUri()).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }

    /** Main thread only, as the lifecycle wants. */
    override fun onForeground(listener: () -> Unit): AutoCloseable {
        val lifecycle = ProcessLifecycleOwner.get().lifecycle
        // Adding an observer replays the current state; that first onStart isn't a return.
        var replayed = lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)
        val observer = object : DefaultLifecycleObserver {
            override fun onStart(owner: LifecycleOwner) {
                if (replayed) replayed = false else listener()
            }
        }
        lifecycle.addObserver(observer)
        return AutoCloseable { lifecycle.removeObserver(observer) }
    }

    override suspend fun download(url: String, version: String, sha512: String, onProgress: (Float) -> Unit): String =
        withContext(Dispatchers.IO) {
            try {
                fetch(url, version, sha512) { done -> withContext(Dispatchers.Main) { onProgress(done) } }
            } catch (e: ApkException) {
                throw e
            } catch (e: kotlinx.coroutines.CancellationException) {
                throw e
            } catch (e: Exception) {
                throw ApkException("The download failed: ${e.message}")
            }
        }

    private suspend fun fetch(url: String, version: String, sha512: String, progress: suspend (Float) -> Unit): String {
        val dir = dir.apply { mkdirs() }
        val file = File(dir, "Relay-$version.apk")
        if (file.exists()) {
            if (sha512.isEmpty() || digestOf(file) == sha512) {
                check(file, version)
                return file.path
            }
            file.delete()
        }
        // Older versions' downloads, and a half-finished one.
        dir.listFiles()?.forEach { it.delete() }
        val part = File(dir, "part-$version.apk")
        val digest = MessageDigest.getInstance("SHA-512")
        val client = http.newBuilder().connectTimeout(15, TimeUnit.SECONDS).readTimeout(30, TimeUnit.SECONDS).build()
        try {
            client.newCall(Request.Builder().url(url).build()).execute().use { response ->
                if (response.code != 200) throw ApkException("The download failed (HTTP ${response.code}).")
                val body = response.body
                val total = body.contentLength()
                var done = 0L
                var reported = -1
                body.byteStream().use { input ->
                    part.outputStream().use { output ->
                        val buffer = ByteArray(64 * 1024)
                        while (true) {
                            kotlin.coroutines.coroutineContext.ensureActive()
                            val n = input.read(buffer)
                            if (n < 0) break
                            output.write(buffer, 0, n)
                            digest.update(buffer, 0, n)
                            done += n
                            val percent = if (total > 0) (done * 100 / total).toInt() else 0
                            if (percent != reported) {
                                reported = percent
                                progress(percent / 100f)
                            }
                        }
                    }
                }
                if (total > 0 && done != total) throw ApkException("The download stopped early.")
            }
            if (sha512.isNotEmpty() && Base64.getEncoder().encodeToString(digest.digest()) != sha512)
                throw ApkException("The download doesn't match the release's checksum.")
            check(part, version)
            if (!part.renameTo(file)) throw ApkException("Couldn't keep the downloaded app.")
            return file.path
        } finally {
            part.delete()
        }
    }

    private fun digestOf(file: File): String {
        val digest = MessageDigest.getInstance("SHA-512")
        file.inputStream().use { input ->
            val buffer = ByteArray(64 * 1024)
            while (true) {
                val n = input.read(buffer)
                if (n < 0) break
                digest.update(buffer, 0, n)
            }
        }
        return Base64.getEncoder().encodeToString(digest.digest())
    }

    /** Catches a wrong file before Android's installer shows its prompt; the signature it checks itself. */
    private fun check(apk: File, version: String) {
        val info = context.packageManager.getPackageArchiveInfo(apk.path, 0)
        if (info == null) {
            apk.delete()
            throw ApkException("The download isn't an Android app.")
        }
        if (info.packageName != context.packageName || info.versionName != version) {
            apk.delete()
            throw ApkException("The download is ${info.packageName} ${info.versionName}, not Relay $version.")
        }
    }

    override fun installsSilently(): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return false
        val source = runCatching { context.packageManager.getInstallSourceInfo(context.packageName) }.getOrNull()
        return source?.installingPackageName == context.packageName
    }

    override suspend fun install(path: String, quiet: Boolean): InstallOutcome = withContext(Dispatchers.IO) {
        val apk = File(path)
        val installer = context.packageManager.packageInstaller
        val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL)
        params.setAppPackageName(context.packageName)
        // Relay updating itself: after the first update Android needs no prompt.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S)
            params.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED)
        val id = installer.createSession(params)
        val answer = CompletableDeferred<InstallOutcome>()
        InstallReceiver.quiet = quiet
        InstallReceiver.waiting = { status, message ->
            when (status) {
                PackageInstaller.STATUS_SUCCESS -> answer.complete(InstallOutcome.Installed)
                PackageInstaller.STATUS_FAILURE_ABORTED -> answer.complete(InstallOutcome.Cancelled)
                PackageInstaller.STATUS_FAILURE_CONFLICT, PackageInstaller.STATUS_FAILURE_INCOMPATIBLE ->
                    answer.completeExceptionally(ApkException("Android refused the update: it isn't signed like this Relay."))
                else -> answer.completeExceptionally(ApkException(message ?: "Android couldn't install the update."))
            }
        }
        try {
            installer.openSession(id).use { session ->
                apk.inputStream().use { input ->
                    session.openWrite("Relay.apk", 0, apk.length()).use { output ->
                        input.copyTo(output)
                        session.fsync(output)
                    }
                }
                val intent = Intent(context, InstallReceiver::class.java).setPackage(context.packageName)
                // Mutable: the installer adds the outcome to it.
                val flags = PendingIntent.FLAG_UPDATE_CURRENT or
                    (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) PendingIntent.FLAG_MUTABLE else 0)
                session.commit(PendingIntent.getBroadcast(context, id, intent, flags).intentSender)
            }
        } catch (e: Exception) {
            InstallReceiver.waiting = null
            installer.abandonSession(id)
            throw ApkException("Couldn't hand the update to Android: ${e.message}")
        }
        answer.await()
    }
}

/** Where Android's installer reports on an install session Relay committed. Not exported. */
class InstallReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)
        if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
            // A background install never puts a prompt up out of nowhere.
            if (quiet) {
                val id = intent.getIntExtra(PackageInstaller.EXTRA_SESSION_ID, -1)
                if (id != -1) runCatching { context.packageManager.packageInstaller.abandonSession(id) }
                waiting?.invoke(PackageInstaller.STATUS_FAILURE_ABORTED, null)
                waiting = null
                return
            }
            val confirm = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU)
                intent.getParcelableExtra(Intent.EXTRA_INTENT, Intent::class.java)
            else @Suppress("DEPRECATION") intent.getParcelableExtra(Intent.EXTRA_INTENT)
            confirm?.let { context.startActivity(it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
            return
        }
        // On success Android replaces this process, so that answer rarely arrives.
        waiting?.invoke(status, intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE))
        waiting = null
    }

    companion object {
        @Volatile var waiting: ((Int, String?) -> Unit)? = null
        @Volatile var quiet = false
    }
}
