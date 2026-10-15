import java.util.Properties

// Relay's release key: from the environment on the mini (signing.env sourced), else
// the same file on this Mac. Without either, debug builds work and release builds fail:
// an APK signed with any other key can never update the installed app.
val signing: Map<String, String> = run {
    val file = File(System.getProperty("user.home"), ".config/relay-android/signing.env")
    val fromFile = if (file.isFile) Properties().apply { file.reader().use { load(it) } }
        .entries.associate { (k, v) -> k.toString() to v.toString().trim('"', '\'') } else emptyMap()
    listOf("RELAY_ANDROID_KEYSTORE", "RELAY_ANDROID_KEYSTORE_PASSWORD", "RELAY_ANDROID_KEY_ALIAS", "RELAY_ANDROID_KEY_PASSWORD")
        .mapNotNull { key -> (System.getenv(key) ?: fromFile[key])?.let { key to it } }.toMap()
}
if (signing.size in 1..3) {
    throw GradleException("Relay's Android signing is incomplete: ${signing.keys.sorted().joinToString()} set, all four RELAY_ANDROID_* needed.")
}
val unsignedRelease = "Relay's Android release key isn't set up (RELAY_ANDROID_* or ~/.config/relay-android/signing.env)."
// Fails before the build starts when a release task is asked for by name; packageRelease below catches the rest.
val shipsRelease = gradle.startParameter.taskNames.map { it.substringAfterLast(':') }.any { name ->
    listOf("assemble", "bundle", "package", "install").any(name::startsWith) && name.contains("Release")
}
if (signing.isEmpty() && shipsRelease) {
    throw GradleException(unsignedRelease)
}

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
}

android {
    namespace = "dev.relay.android"
    compileSdk = 37

    defaultConfig {
        // Its own id, so it installs beside the Expo app (dev.relay.remote) and keeps its pairing.
        applicationId = "dev.relay.android"
        minSdk = 29
        targetSdk = 36
        // The release's own version on the mini; versionCode grows as major*1e6+minor*1e3+patch.
        versionCode = System.getenv("RELAY_VERSION_CODE")?.toInt() ?: 1
        versionName = System.getenv("RELAY_VERSION") ?: "0.1.0"
    }

    signingConfigs {
        if (signing.size == 4) create("relay") {
            storeFile = file(signing.getValue("RELAY_ANDROID_KEYSTORE"))
            storePassword = signing.getValue("RELAY_ANDROID_KEYSTORE_PASSWORD")
            keyAlias = signing.getValue("RELAY_ANDROID_KEY_ALIAS")
            keyPassword = signing.getValue("RELAY_ANDROID_KEY_PASSWORD")
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            // Updates must keep one key forever: Android refuses an APK signed differently.
            signingConfig = signingConfigs.findByName("relay")
        }
    }
    buildFeatures { compose = true }
    packaging { resources.excludes += "/META-INF/{AL2.0,LGPL2.1}" }
}

kotlin { jvmToolchain(21) }

if (signing.isEmpty()) tasks.matching { it.name == "packageRelease" }.configureEach {
    // A local copy: the configuration cache can't keep a reference to the script.
    val message = unsignedRelease
    doFirst { throw GradleException(message) }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.activity.compose)
    implementation(platform(libs.compose.bom))
    implementation(libs.compose.ui)
    implementation(libs.compose.foundation)
    implementation(libs.compose.material3)
    implementation(libs.compose.ui.tooling.preview)
    debugImplementation(libs.compose.ui.tooling)
    implementation(libs.material3.adaptive)
    implementation(libs.material3.adaptive.layout)
    implementation(libs.material3.adaptive.navigation3)
    implementation(libs.navigation3.runtime)
    implementation(libs.navigation3.ui)
    implementation(libs.lifecycle.runtime.compose)
    implementation(libs.lifecycle.viewmodel.compose)
    implementation(libs.lifecycle.viewmodel.navigation3)
    implementation(libs.lifecycle.process)
    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.kotlinx.serialization.json)
    implementation(libs.datastore.preferences)
    implementation(libs.coil.compose)
    implementation(libs.camerax.camera2)
    implementation(libs.camerax.lifecycle)
    implementation(libs.camerax.compose)
    implementation(libs.mlkit.barcode)
    implementation(libs.androidx.webkit)
    implementation(libs.okhttp)
    implementation(libs.bouncycastle)
    implementation(libs.tabler.icons)
    implementation(libs.commonmark)
    implementation(libs.commonmark.gfm.tables)
    implementation(libs.commonmark.gfm.strikethrough)
    implementation(libs.commonmark.task.list.items)
    implementation(libs.commonmark.autolink)

    testImplementation(libs.junit)
    testImplementation(libs.kotlinx.coroutines.test)
}
