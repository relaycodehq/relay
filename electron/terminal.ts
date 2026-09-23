import { spawn } from "node:child_process";
import { findExecutable } from "./executables";

function start(executable: string, args: string[], dir: string) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: dir,
      detached: true,
      stdio: "ignore",
    });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

/** Windows Terminal when installed, otherwise PowerShell in its own console. */
export async function openWindowsTerminal(dir: string, scriptPath: string) {
  const powershell = [
    "powershell.exe",
    "-NoExit",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    scriptPath,
  ];
  try {
    await start(await findExecutable("wt"), ["-d", dir, ...powershell], dir);
  } catch {
    await start(powershell[0], powershell.slice(1), dir);
  }
}

export async function openLinuxTerminal(dir: string, scriptPath: string) {
  // Omarchy selects Foot/Ghostty/Alacritty/Kitty through xdg-terminal-exec.
  // Pass the repository explicitly: a terminal server may have a different cwd.
  // Keep paths as arguments, never interpolate them into a shell command.
  for (const [bin, args] of [
    ["xdg-terminal-exec", [`--dir=${dir}`, "--", scriptPath]],
    ["x-terminal-emulator", ["-e", scriptPath]],
    ["gnome-terminal", ["--", scriptPath]],
    ["konsole", ["-e", scriptPath]],
    ["xfce4-terminal", ["--execute", scriptPath]],
    ["xterm", ["-e", scriptPath]],
  ] as [string, string[]][]) {
    try {
      await start(await findExecutable(bin), args, dir);
      return;
    } catch {}
  }
  throw new Error(
    "No supported terminal was found. Configure xdg-terminal-exec (Omarchy’s default terminal launcher), or install GNOME Terminal, Konsole, Xfce Terminal, or xterm.",
  );
}
