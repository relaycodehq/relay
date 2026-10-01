package expo.modules.relayapk

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.os.Build

/** Where Android's installer reports on an install session Relay committed. */
class InstallReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)
    if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
      val confirm = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU)
        intent.getParcelableExtra(Intent.EXTRA_INTENT, Intent::class.java)
      else
        @Suppress("DEPRECATION") intent.getParcelableExtra(Intent.EXTRA_INTENT)
      confirm?.let { context.startActivity(it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
      return
    }
    // On success Android replaces this process, so that answer rarely arrives.
    waiting?.invoke(status, intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE))
    waiting = null
  }

  companion object {
    @Volatile var waiting: ((Int, String?) -> Unit)? = null
  }
}
