const { app } = require("electron");
app.setPath("userData", process.env.RELAY_TEST_DATA);
globalThis.fetch = async () => {
  throw new Error("Node networking must not handle desktop API requests");
};
require("../../dist-electron/main.cjs");
