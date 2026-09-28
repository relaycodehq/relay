package expo.modules.relaybundle

import android.content.Context
import android.content.SharedPreferences
import android.os.Build
import java.io.File
import java.security.MessageDigest

/**
 * The phone app's code as the paired desktop last handed it over, kept beside
 * the one inside the APK. React Native loads it instead of the APK's until the
 * APK itself changes, or a launch with it never confirms, which drops it.
 */
class RelayBundleStore(private val context: Context) {
  private val root = File(context.filesDir, "relay-bundle")
  private val staging = File(root, ".staging")
  private val prefs: SharedPreferences =
    context.getSharedPreferences("relay-bundle", Context.MODE_PRIVATE)

  companion object {
    const val BUNDLE = "index.android.bundle"

    /** The version this process handed to React Native; null while the APK's own runs. */
    @Volatile
    var running: String? = null
      private set
  }

  private fun apkVersion(): Long {
    val info = context.packageManager.getPackageInfo(context.packageName, 0)
    @Suppress("DEPRECATION")
    return if (Build.VERSION.SDK_INT >= 28) info.longVersionCode else info.versionCode.toLong()
  }

  private fun dir(version: String) = File(root, version)

  /** What React Native should load, or null for the APK's own bundle. */
  fun launchPath(): String? {
    val version = prefs.getString("version", null) ?: return null
    val file = File(dir(version), BUNDLE)
    // A reload in the same process asks again; that isn't a second launch.
    if (running == version && file.exists()) return file.absolutePath
    if (prefs.getLong("apk", -1) != apkVersion() || !file.exists()) {
      clear()
      return null
    }
    if (prefs.getBoolean("launching", false)) {
      // The last launch with it never got as far as the app confirming it.
      prefs.edit().putString("failed", version).apply()
      clear()
      return null
    }
    prefs.edit().putBoolean("launching", true).commit()
    running = version
    return file.absolutePath
  }

  /** The app came up on it; keep it. */
  fun confirm() {
    prefs.edit().remove("launching").apply()
  }

  val failed: String? get() = prefs.getString("failed", null)

  fun begin() {
    staging.deleteRecursively()
    staging.mkdirs()
  }

  fun append(path: String, bytes: ByteArray) {
    val file = safe(staging, path)
    file.parentFile?.mkdirs()
    file.appendBytes(bytes)
  }

  /** Checks every file against the desktop's manifest, then makes it the next launch's code. */
  fun commit(version: String, files: List<Pair<String, String>>) {
    require(Regex("^\\d+\\.\\d+\\.\\d+$").matches(version)) { "Not a version: $version" }
    for ((path, sha256) in files) {
      val file = safe(staging, path)
      require(file.exists()) { "$path didn't arrive" }
      val digest = MessageDigest.getInstance("SHA-256").digest(file.readBytes())
      val hex = digest.joinToString("") { "%02x".format(it) }
      require(hex == sha256) { "$path arrived damaged" }
    }
    require(File(staging, BUNDLE).exists()) { "The bundle itself didn't arrive" }
    val target = dir(version)
    target.deleteRecursively()
    require(staging.renameTo(target)) { "Couldn't keep the update" }
    prefs.edit()
      .putString("version", version)
      .putLong("apk", apkVersion())
      .remove("launching")
      .remove("failed")
      .commit()
    // Only what runs now and what runs next stay.
    root.listFiles()?.forEach { if (it.name != version && it.name != running) it.deleteRecursively() }
  }

  /** Back to the APK's own code from the next launch. */
  fun clear() {
    prefs.edit().remove("version").remove("apk").remove("launching").commit()
    root.listFiles()?.forEach { if (it.name != running) it.deleteRecursively() }
  }

  private fun safe(base: File, path: String): File {
    val file = File(base, path).canonicalFile
    require(file.path.startsWith(base.canonicalPath + File.separator)) { "Bad path: $path" }
    return file
  }
}
