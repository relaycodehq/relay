package expo.modules.relaybundle

import android.util.Base64
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class RelayBundleModule : Module() {
  private val store: RelayBundleStore
    get() = RelayBundleStore(appContext.reactContext ?: throw Exceptions.ReactContextLost())

  override fun definition() = ModuleDefinition {
    Name("RelayBundle")

    Constant("running") { RelayBundleStore.running }
    Constant("failed") { store.failed }

    Function("confirm") { store.confirm() }
    AsyncFunction("begin") { store.begin() }
    AsyncFunction("append") { path: String, base64: String ->
      store.append(path, Base64.decode(base64, Base64.DEFAULT))
    }
    AsyncFunction("commit") { version: String, files: List<Map<String, String>> ->
      store.commit(version, files.map { (it["path"] ?: "") to (it["sha256"] ?: "") })
    }
    AsyncFunction("clear") { store.clear() }
  }
}
