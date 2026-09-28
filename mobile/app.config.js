// app.json with what a release build stamps in: the desktop's version, and a
// versionCode that grows with every release so Android accepts the update.
module.exports = ({ config }) => ({
  ...config,
  version: process.env.RELAY_VERSION ?? config.version,
  android: {
    ...config.android,
    versionCode: Number(process.env.RELAY_VERSION_CODE ?? 1),
  },
  plugins: [...config.plugins, "./plugins/release-signing"],
});
