// Signs release builds with Relay's own key when RELAY_ANDROID_KEYSTORE points
// at it (CI, or a local build meant for a phone that already has a release).
// Without it, release builds fall back to the debug key like Expo's template.
// Android only installs an update signed by the same key as the installed app.
const { withAppBuildGradle } = require("expo/config-plugins");

const releaseConfig = `
        release {
            if (System.getenv('RELAY_ANDROID_KEYSTORE')) {
                storeFile file(System.getenv('RELAY_ANDROID_KEYSTORE'))
                storePassword System.getenv('RELAY_ANDROID_KEYSTORE_PASSWORD')
                keyAlias System.getenv('RELAY_ANDROID_KEY_ALIAS')
                keyPassword System.getenv('RELAY_ANDROID_KEY_PASSWORD')
            }
        }`;

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (config) => {
    let gradle = config.modResults.contents;
    if (gradle.includes("RELAY_ANDROID_KEYSTORE")) return config;
    const debugConfig = /(signingConfigs \{\s*debug \{[^}]*\})/;
    const releaseType = /(buildTypes \{[\s\S]*?release \{[\s\S]*?)signingConfig signingConfigs\.debug/;
    if (!debugConfig.test(gradle) || !releaseType.test(gradle))
      throw new Error("release-signing: app/build.gradle no longer looks like Expo's template");
    gradle = gradle
      .replace(debugConfig, `$1${releaseConfig}`)
      .replace(
        releaseType,
        "$1signingConfig System.getenv('RELAY_ANDROID_KEYSTORE') ? signingConfigs.release : signingConfigs.debug",
      );
    config.modResults.contents = gradle;
    return config;
  });
};
