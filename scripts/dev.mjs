import { spawn } from "node:child_process";
import { delimiter } from "node:path";
import "./build-electron.mjs";
// Moved up by a worktree's offset, like vite.config.ts.
const url = `http://127.0.0.1:${5177 + (Number(process.env.RELAY_PORT_OFFSET) || 0)}`;
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
    await fetch(url);
    break;
  } catch {
    await new Promise((r) => setTimeout(r, 100));
  }
}
// npm run puts every ancestor's node_modules/.bin first on PATH; a stray
// ~/node_modules/.bin/claude would then win over the user's real CLI.
const PATH = (process.env.PATH ?? "")
  .split(delimiter)
  .filter((dir) => !/[\\/]node_modules[\\/]\.bin$/.test(dir))
  .join(delimiter);
electron = spawn("node_modules/.bin/electron", ["."], {
  stdio: "inherit",
  env: { ...process.env, PATH, RELAY_DEV_URL: url },
});
electron.on("exit", () => {
  vite.kill();
  process.exit();
});
