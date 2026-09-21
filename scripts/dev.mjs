import { spawn } from "node:child_process";
import "./build-electron.mjs";
const vite = spawn("npm", ["run", "dev:web"], { stdio: "inherit" });
let electron;
const stop = () => {
  vite.kill();
  electron?.kill();
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
for (let i = 0; i < 100; i++) {
  try {
    await fetch("http://127.0.0.1:5177");
    break;
  } catch {
    await new Promise((r) => setTimeout(r, 100));
  }
}
electron = spawn("node_modules/.bin/electron", ["."], {
  stdio: "inherit",
  env: { ...process.env, RELAY_DEV_URL: "http://127.0.0.1:5177" },
});
electron.on("exit", () => {
  vite.kill();
  process.exit();
});
