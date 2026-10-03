// Folding or unfolding a foldable moves the app to a screen of another
// density. Expo's template doesn't list `density` among the changes the
// activity handles itself, so Android recreated it, and React Navigation
// started over: the open thread was gone, or left alone on the stack with
// nothing to go back to.
const { AndroidConfig, withAndroidManifest } = require("expo/config-plugins");

const handled = ["density"];

module.exports = function withFoldConfigChanges(config) {
  return withAndroidManifest(config, (config) => {
    const activity = AndroidConfig.Manifest.getMainActivityOrThrow(config.modResults);
    const changes = (activity.$["android:configChanges"] ?? "").split("|").filter(Boolean);
    for (const change of handled) if (!changes.includes(change)) changes.push(change);
    activity.$["android:configChanges"] = changes.join("|");
    return config;
  });
};
