package expo.modules.relaybundle

import android.content.Context
import expo.modules.core.interfaces.Package
import expo.modules.core.interfaces.ReactNativeHostHandler

/** Points React Native at the desktop's newer code when there is some; see RelayBundleStore. */
class RelayBundlePackage : Package {
  override fun createReactNativeHostHandlers(context: Context): List<ReactNativeHostHandler> =
    listOf(object : ReactNativeHostHandler {
      override fun getJSBundleFile(useDeveloperSupport: Boolean): String? =
        if (useDeveloperSupport) null else RelayBundleStore(context).launchPath()
    })
}
