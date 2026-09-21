const { app } = require("electron");
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
