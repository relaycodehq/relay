const { safeStorage } = require("electron");
// Only this isolated launcher replaces Keychain; production has no test switches.
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
require("./launch.cjs");
