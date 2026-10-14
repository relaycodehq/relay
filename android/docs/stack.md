Here's the stack, checked against Maven metadata (Google Maven, Maven Central, services.gradle.org) on 2026-10-14. Short version: AGP 9.4.1, Gradle 9.8.1, Kotlin 2.4.21, Compose BOM 2026.09.00, and Navigation 3 is now stable at 1.2.0. Each version below is the newest stable release in its metadata. The main thing I couldn't confirm is AGP 9.4's minimum Gradle; the rest of the gaps are marked in the notes.

```toml
# gradle/libs.versions.toml
[versions]
agp = "9.4.1"                 # Gradle wrapper: 9.8.1 (gradle-wrapper.properties)
kotlin = "2.4.21"             # also the Compose compiler plugin version
ksp = "2.3.12"                # KSP2, no longer tied to the Kotlin version
composeBom = "2026.09.00"     # ui/foundation 1.12.1, material3 1.4.0
material3Adaptive = "1.3.0"
activityCompose = "1.13.0"
coreKtx = "1.19.1"
lifecycle = "2.11.0"
navigation3 = "1.2.0"
coroutines = "1.11.0"
serialization = "1.11.0"      # 1.12.0-RC exists, skip it
datastore = "1.2.1"
koin = "4.2.2"
hilt = "2.60.1"
hiltAndroidx = "1.4.0"
coil = "3.6.3"
camerax = "1.6.2"
mlkitBarcode = "17.3.0"
work = "2.12.0"
webkit = "1.17.1"
media3 = "1.11.1"
okhttp = "5.5.0"
ktor = "3.6.0"
tink = "1.23.0"
lazysodium = "5.2.0"
bouncycastle = "1.86"
markdown = "0.46.0"
highlights = "1.1.0"

[libraries]
androidx-core-ktx = { module = "androidx.core:core-ktx", version.ref = "coreKtx" }
androidx-activity-compose = { module = "androidx.activity:activity-compose", version.ref = "activityCompose" }
compose-bom = { module = "androidx.compose:compose-bom", version.ref = "composeBom" }
compose-ui = { module = "androidx.compose.ui:ui" }
compose-ui-tooling = { module = "androidx.compose.ui:ui-tooling" }
compose-ui-tooling-preview = { module = "androidx.compose.ui:ui-tooling-preview" }
compose-material3 = { module = "androidx.compose.material3:material3" }
compose-material3-navsuite = { module = "androidx.compose.material3:material3-adaptive-navigation-suite" }
material3-adaptive = { module = "androidx.compose.material3.adaptive:adaptive", version.ref = "material3Adaptive" }
material3-adaptive-layout = { module = "androidx.compose.material3.adaptive:adaptive-layout", version.ref = "material3Adaptive" }
material3-adaptive-navigation3 = { module = "androidx.compose.material3.adaptive:adaptive-navigation3", version.ref = "material3Adaptive" }
navigation3-runtime = { module = "androidx.navigation3:navigation3-runtime", version.ref = "navigation3" }
navigation3-ui = { module = "androidx.navigation3:navigation3-ui", version.ref = "navigation3" }
lifecycle-runtime-compose = { module = "androidx.lifecycle:lifecycle-runtime-compose", version.ref = "lifecycle" }
lifecycle-viewmodel-compose = { module = "androidx.lifecycle:lifecycle-viewmodel-compose", version.ref = "lifecycle" }
lifecycle-viewmodel-navigation3 = { module = "androidx.lifecycle:lifecycle-viewmodel-navigation3", version.ref = "lifecycle" }
lifecycle-process = { module = "androidx.lifecycle:lifecycle-process", version.ref = "lifecycle" }
kotlinx-coroutines-android = { module = "org.jetbrains.kotlinx:kotlinx-coroutines-android", version.ref = "coroutines" }
kotlinx-serialization-json = { module = "org.jetbrains.kotlinx:kotlinx-serialization-json", version.ref = "serialization" }
datastore = { module = "androidx.datastore:datastore", version.ref = "datastore" }
datastore-preferences = { module = "androidx.datastore:datastore-preferences", version.ref = "datastore" }
koin-bom = { module = "io.insert-koin:koin-bom", version.ref = "koin" }
koin-androidx-compose = { module = "io.insert-koin:koin-androidx-compose" }
hilt-android = { module = "com.google.dagger:hilt-android", version.ref = "hilt" }
hilt-compiler = { module = "com.google.dagger:hilt-compiler", version.ref = "hilt" }
hilt-lifecycle-viewmodel-compose = { module = "androidx.hilt:hilt-lifecycle-viewmodel-compose", version.ref = "hiltAndroidx" }
coil-compose = { module = "io.coil-kt.coil3:coil-compose", version.ref = "coil" }
coil-network-okhttp = { module = "io.coil-kt.coil3:coil-network-okhttp", version.ref = "coil" }
camerax-camera2 = { module = "androidx.camera:camera-camera2", version.ref = "camerax" }
camerax-lifecycle = { module = "androidx.camera:camera-lifecycle", version.ref = "camerax" }
camerax-compose = { module = "androidx.camera:camera-compose", version.ref = "camerax" }
mlkit-barcode = { module = "com.google.mlkit:barcode-scanning", version.ref = "mlkitBarcode" }
work-runtime-ktx = { module = "androidx.work:work-runtime-ktx", version.ref = "work" }
androidx-webkit = { module = "androidx.webkit:webkit", version.ref = "webkit" }
media3-exoplayer = { module = "androidx.media3:media3-exoplayer", version.ref = "media3" }
media3-ui-compose = { module = "androidx.media3:media3-ui-compose", version.ref = "media3" }
okhttp = { module = "com.squareup.okhttp3:okhttp", version.ref = "okhttp" }
ktor-client-okhttp = { module = "io.ktor:ktor-client-okhttp", version.ref = "ktor" }
tink-android = { module = "com.google.crypto.tink:tink-android", version.ref = "tink" }
lazysodium-android = { module = "com.goterl:lazysodium-android", version.ref = "lazysodium" }
bouncycastle = { module = "org.bouncycastle:bcprov-jdk18on", version.ref = "bouncycastle" }
markdown-m3 = { module = "com.mikepenz:multiplatform-markdown-renderer-m3", version.ref = "markdown" }
markdown-coil3 = { module = "com.mikepenz:multiplatform-markdown-renderer-coil3", version.ref = "markdown" }
highlights = { module = "dev.snipme:highlights", version.ref = "highlights" }

[plugins]
android-application = { id = "com.android.application", version.ref = "agp" }
kotlin-compose = { id = "org.jetbrains.kotlin.plugin.compose", version.ref = "kotlin" }
kotlin-serialization = { id = "org.jetbrains.kotlin.plugin.serialization", version.ref = "kotlin" }
ksp = { id = "com.google.devtools.ksp", version.ref = "ksp" }
hilt = { id = "com.google.dagger.hilt.android", version.ref = "hilt" }
```

**Notes and gotchas**

- **SDK:** use `compileSdk = 37`, `targetSdk = 36` (or 37 if you want to deal with its behaviour changes now), `minSdk = 26`, and the JDK 21 toolchain. I didn't check what targetSdk 37 changes, and nothing in this setup needs 37.
- **AGP 9 has Kotlin built in.** Don't apply `org.jetbrains.kotlin.android`; AGP 9 compiles Kotlin itself. You still apply the Compose compiler plugin, and its version has to match Kotlin. This is from memory of the AGP 9.0 notes, so check the migration guide when you set up.
- **AGP 9.4.1 with Gradle 9.8.1:** 9.8.1 is the current Gradle release. I couldn't find AGP 9.4's minimum Gradle version on the release page; Gradle 9.x is required, and the newest 9.x should be fine.
- **KSP 2.3.x** has its own version numbers now, so you don't bump it with Kotlin. Only needed if you pick Hilt or Room.
- **Navigation 3 (1.2.0 stable) is the default for new Compose apps.** You own the back stack as a plain list. Add `lifecycle-viewmodel-navigation3` so each screen gets its own ViewModel scope, and `adaptive-navigation3` for list–detail scenes. Navigation 2.10.x is fine but it's the older model.
- **Material 3 Expressive is still not stable.** BOM 2026.09.00 ships material3 1.4.0, while the expressive components are in 1.5.0 (only at beta01, with `@ExperimentalMaterial3ExpressiveApi`). I'd stay on the BOM's 1.4.0 and pin 1.5.0-beta01 only if you really want the expressive bits.
- **Edge-to-edge is forced from targetSdk 35,** and from 36 you can't opt out. Lay out with `WindowInsets.safeDrawing` and `Scaffold` padding, and handle the IME with `imePadding()`.
- **Predictive back is on by default from targetSdk 36.** `onBackPressed` and `KEYCODE_BACK` aren't called anymore; use `BackHandler`/`PredictiveBackHandler`, which Navigation 3 already wires up.
- **16 KB page size is required for Play** on targetSdk 35+. Recent AGP aligns uncompressed native libraries for you. Tink is pure Java, but check lazysodium's `.so` files: I didn't verify they're 16 KB aligned.
- **Foldables (Fold7):** build on window size classes from `currentWindowAdaptiveInfo()`, use `NavigationSuiteScaffold` plus list–detail, and test unfolding (the configuration change) with state in `rememberSaveable`/ViewModels. On large screens, Android 16 ignores orientation and resizability locks, so don't lock to portrait.
- **DI:** Hilt is still Google's official choice. For one app module I'd skip both and write a small `AppContainer` by hand; Koin 4.2 is the lighter middle ground. Metro (`dev.zacsweers.metro` 1.4.5) is the up-and-coming one but not standard yet.
- **EncryptedSharedPreferences is deprecated** (security-crypto 1.1.0 marks it). The replacement is DataStore with a key generated in Android Keystore, ideally StrongBox (`setIsStrongBoxBacked`), with the Keystore key wrapping a Tink keyset, which then encrypts the bytes. For a few secrets, a Keystore AES-GCM key encrypting a DataStore value is enough.
- **Crypto:** Tink 1.23.0 has X25519, ChaCha20-Poly1305/XChaCha20-Poly1305 and HKDF-SHA256 as low-level subtle primitives. I'm not fully sure every class is public API (`X25519`, `XChaCha20Poly1305`, `Hkdf`). If you need byte-for-byte compatibility with libsodium on the desktop (e.g. `crypto_box` or secretstream), use lazysodium-android 5.2.0; it's the safest match, but it's JNA plus native code and has had few releases. BouncyCastle 1.86 works but is heavy, so keep it as a fallback.
- **WebSocket:** OkHttp 5.5.0's `WebSocket` is the simplest choice. Ktor 3.6 on top of OkHttp only pays off if you want coroutine-style websocket sessions or multiplatform.
- **Markdown and highlighting:** mikepenz multiplatform-markdown-renderer 0.46.0 is the best-maintained Compose-native option; it plugs into Coil 3 for images, and its code module uses Highlights. dev.snipme Highlights 1.1.0 does syntax highlighting. I didn't check that 0.46.0 resolves Highlights 1.1.0; it might pin an older one.
- **QR pairing:** CameraX 1.6.2 with `camera-compose` (`CameraXViewfinder`) plus ML Kit barcode 17.3.0. The bundled ML Kit model makes the APK about 2.4 MB bigger but works offline. Since your APK is installed outside Play, use the bundled model, not the Play Services one.
- **Skip the pre-releases** still showing as latest: AGP 9.5 alphas, Kotlin 2.5.0-Beta1, lifecycle 2.12 alphas, Navigation 3 1.3 alphas, DataStore 1.3.0-rc01, webkit 1.18.0-rc01.

**Not checked:** the full contents of the BOM (I checked material3, ui, foundation and the navigation suite), AGP 9.4's minimum Gradle, the 16 KB alignment of lazysodium's native libraries, which Highlights version the markdown renderer pulls in, and whether every Tink low-level primitive is public API. I haven't built a project with this file.