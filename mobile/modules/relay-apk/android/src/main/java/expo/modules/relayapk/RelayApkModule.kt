package expo.modules.relayapk

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.net.ConnectivityManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.util.Base64
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

/**
 * Installs a newer Relay APK, when the desktop's version needs native changes
 * its code can't bring or the release feed has a newer app. Android only
 * accepts an update signed with the same key as the installed app; the feed's
 * checksum, when there is one, catches a wrong or damaged file before that.
 */
class RelayApkModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("RelayApk")
    Events("onProgress")

    // The update this app came up from has done its job.
    OnCreate {
      val installed = context.packageManager.getPackageInfo(context.packageName, 0).versionName
      File(context.cacheDir, "apk/Relay-$installed.apk").delete()
    }

    /** Whether the user lets Relay install apps ("Install unknown apps"). */
    Function("canInstall") {
      Build.VERSION.SDK_INT < Build.VERSION_CODES.O || context.packageManager.canRequestPackageInstalls()
    }
    /** Opens the system screen where the user allows that. */
    Function("allowInstalls") {
      val intent = Intent(
        Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
        Uri.parse("package:${context.packageName}"),
      )
      val activity = appContext.currentActivity
      if (activity != null) activity.startActivity(intent)
      else context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }
    /** Tells JS that download takes the feed's checksum as a third argument. */
    Constant("checksums") { true }
    /** Whether the network in use costs by the byte, so an update shouldn't download unasked. */
    Function("metered") {
      (context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager).isActiveNetworkMetered
    }
    /**
     * Fetches the APK for `version` (once; a second call reuses it) and answers its path.
     * `sha512` is the release feed's, base64; empty when the feed has none.
     */
    AsyncFunction("download") { url: String, version: String, sha512: String, promise: Promise ->
      // Its own thread: a slow download mustn't hold up other modules' calls.
      Thread({ settle(promise) { download(url, version, sha512) } }, "RelayApk").start()
    }
    /** Hands the APK to Android's installer; answers "cancelled" if the user backs out. */
    AsyncFunction("install") { path: String, promise: Promise -> install(File(path), promise) }
  }

  private fun download(url: String, version: String, sha512: String): String {
    val dir = File(context.cacheDir, "apk").apply { mkdirs() }
    val file = File(dir, "Relay-$version.apk")
    if (file.exists()) {
      if (sha512.isEmpty() || digestOf(file) == sha512) return file.path
      file.delete()
    }
    // Older versions' downloads, and a half-finished one.
    dir.listFiles()?.forEach { it.delete() }
    val part = File(dir, "part-$version.apk")
    val digest = MessageDigest.getInstance("SHA-512")
    val connection = URL(url).openConnection() as HttpURLConnection
    connection.connectTimeout = 15_000
    connection.readTimeout = 30_000
    try {
      if (connection.responseCode != HttpURLConnection.HTTP_OK)
        throw ApkException("The download failed (HTTP ${connection.responseCode}).")
      val total = connection.contentLengthLong
      var done = 0L
      var reported = -1
      connection.inputStream.use { input ->
        part.outputStream().use { output ->
          val buffer = ByteArray(64 * 1024)
          while (true) {
            val n = input.read(buffer)
            if (n < 0) break
            output.write(buffer, 0, n)
            digest.update(buffer, 0, n)
            done += n
            val percent = if (total > 0) (done * 100 / total).toInt() else 0
            if (percent != reported) {
              reported = percent
              sendEvent("onProgress", mapOf("done" to percent / 100.0))
            }
          }
        }
      }
      if (total > 0 && done != total) throw ApkException("The download stopped early.")
    } finally {
      connection.disconnect()
    }
    if (sha512.isNotEmpty() && Base64.encodeToString(digest.digest(), Base64.NO_WRAP) != sha512) {
      part.delete()
      throw ApkException("The download doesn't match the release's checksum.")
    }
    check(part, version)
    part.renameTo(file)
    return file.path
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
    return Base64.encodeToString(digest.digest(), Base64.NO_WRAP)
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

  private fun install(apk: File, promise: Promise) {
    val installer = context.packageManager.packageInstaller
    val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL)
    params.setAppPackageName(context.packageName)
    val id = installer.createSession(params)
    InstallReceiver.waiting = { status, message ->
      when (status) {
        PackageInstaller.STATUS_SUCCESS -> promise.resolve("installed")
        PackageInstaller.STATUS_FAILURE_ABORTED -> promise.resolve("cancelled")
        PackageInstaller.STATUS_FAILURE_CONFLICT, PackageInstaller.STATUS_FAILURE_INCOMPATIBLE ->
          promise.reject(ApkException("Android refused the update: it isn't signed like this Relay."))
        else -> promise.reject(ApkException(message ?: "Android couldn't install the update."))
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
        val intent = Intent(context, InstallReceiver::class.java)
        // Mutable: the installer adds the outcome to it.
        val flags = PendingIntent.FLAG_UPDATE_CURRENT or
          (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) PendingIntent.FLAG_MUTABLE else 0)
        session.commit(PendingIntent.getBroadcast(context, id, intent, flags).intentSender)
      }
    } catch (e: Exception) {
      InstallReceiver.waiting = null
      installer.abandonSession(id)
      promise.reject(ApkException("Couldn't hand the update to Android: ${e.message}"))
    }
  }

  private fun settle(promise: Promise, work: () -> Any) {
    try {
      promise.resolve(work())
    } catch (e: CodedException) {
      promise.reject(e)
    } catch (e: Exception) {
      promise.reject(ApkException("The download failed: ${e.message}"))
    }
  }
}

private class ApkException(message: String) : CodedException("ERR_RELAY_APK", message, null)
