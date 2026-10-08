import { execFile } from "node:child_process";

/** Only for dev servers, never Electron: its detached hosts must survive. */
export async function stopDevServer(child) {
  if (child.exitCode !== null || child.signalCode) return;
  if (process.platform === "win32") {
    await new Promise((resolve, reject) => {
      execFile(
        "taskkill",
        ["/PID", String(child.pid), "/T", "/F"],
        { windowsHide: true },
        (error) => {
          if (error && child.exitCode === null && !child.signalCode)
            reject(error);
          else resolve();
        },
      );
    });
    return;
  }
  const exited = new Promise((resolve) => child.once("exit", resolve));
  const signal = (name) => {
    try {
      process.kill(-child.pid, name);
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
  };
  signal("SIGTERM");
  const timer = setTimeout(() => signal("SIGKILL"), 2000);
  try {
    await exited;
  } finally {
    clearTimeout(timer);
  }
}
