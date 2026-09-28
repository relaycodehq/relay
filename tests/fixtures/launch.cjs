const { app, BrowserWindow, safeStorage } = require("electron");
// All normal E2E runs stay off the user's desktop. Keep this in the fixture,
// never in the shipped app: native visibility checks explicitly opt in.
if (process.env.RELAY_TEST_HEADED !== "1") {
  if (process.platform === "darwin") app.setActivationPolicy("prohibited");
  // A window that is never shown never draws on Windows or Linux, so
  // requestAnimationFrame stalls and Playwright waits forever for a click
  // target to hold still. Show it where nobody sees it instead: see-through
  // where the platform can, and far off-screen where it can't (Linux).
  const showInactive = BrowserWindow.prototype.showInactive;
  const offDesktop = { x: -20000, y: -20000 };
  BrowserWindow.prototype.show = BrowserWindow.prototype.showInactive =
    function () {
      this.setOpacity(0);
      this.setSkipTaskbar(true);
      this.setPosition(offDesktop.x, offDesktop.y);
      showInactive.call(this);
    };
  // A hidden window's "ready-to-show" can come late or never, and tests start
  // clicking as soon as the page loads, so every window shows at once.
  app.on("browser-window-created", (_event, win) => win.show());
  for (const name of ["focus", "restore"])
    BrowserWindow.prototype[name] = () => {};
  app.show = app.focus = () => {};
  for (const flag of [
    "disable-backgrounding-occluded-windows",
    "disable-renderer-backgrounding",
    "disable-background-timer-throttling",
  ])
    app.commandLine.appendSwitch(flag);
}
app.on("session-created", (session) =>
  session.registerPreloadScript({
    type: "frame",
    filePath: require("node:path").join(__dirname, "test-preload.cjs"),
  }),
);
/**
 * Whether a person could see the window: shown, not see-through and on the
 * desktop. Hidden runs show windows to keep them drawing, so `isVisible()`
 * alone no longer says it.
 */
globalThis.relaySeen = (win) =>
  win.isVisible() &&
  win.getOpacity() > 0 &&
  win.getBounds().x + win.getBounds().width > 0;
// Ordinary UI tests must not open the user's Keychain. This reversible fixture
// encoding is test-only; the actual OS integration is a separate opt-in check.
if (process.env.RELAY_TEST_NATIVE_STORAGE !== "1") {
  safeStorage.isEncryptionAvailable = () => true;
  safeStorage.isAsyncEncryptionAvailable = async () => true;
  safeStorage.getSelectedStorageBackend = () => "fixture";
  safeStorage.encryptString = (value) =>
    Buffer.from("fixture:" + Buffer.from(value).toString("base64"));
  safeStorage.encryptStringAsync = async (value) =>
    safeStorage.encryptString(value);
  safeStorage.decryptString = (value) => {
    const text = value.toString();
    if (!text.startsWith("fixture:"))
      throw new Error("Not a fixture credential");
    return Buffer.from(text.slice(8), "base64").toString();
  };
  safeStorage.decryptStringAsync = async (value) => ({
    result: safeStorage.decryptString(value),
    shouldReEncrypt: false,
  });
}
if (process.env.RELAY_TEST_LOCKED_LOGIN === "1") {
  safeStorage.decryptString = () => {
    throw new Error("Synchronous decryption blocks the app");
  };
  safeStorage.decryptStringAsync = () =>
    new Promise((resolve, reject) => {
      globalThis.finishUnlock = (success) =>
        success
          ? resolve({ result: "test-token", shouldReEncrypt: false })
          : reject(new Error("Keychain access denied"));
    });
}
// Keep sibling-profile discovery away from the user's real Application Support.
app.setPath(
  "appData",
  require("node:path").join(process.env.RELAY_TEST_DATA, "app-data"),
);
app.setPath("userData", process.env.RELAY_TEST_DATA);
globalThis.fetch = async () => {
  throw new Error("Node networking must not handle desktop API requests");
};
require("../../dist-electron/main.cjs");
