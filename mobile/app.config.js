// app.json with what a release build stamps in: the desktop's version, the
// native runtime, and a versionCode that grows with every release so Android
// accepts the update.
module.exports = ({ config }) => ({
  ...config,
  version: process.env.RELAY_VERSION ?? config.version,
  extra: {
    ...config.extra,
    // scripts/runtime.mjs, so the app knows which desktop updates it can run.
    ...(process.env.RELAY_RUNTIME ? { relayRuntime: process.env.RELAY_RUNTIME } : {}),
  },
  android: {
    ...config.android,
    versionCode: Number(process.env.RELAY_VERSION_CODE ?? 1),
  },
  plugins: [...config.plugins, "./plugins/release-signing"],
});
