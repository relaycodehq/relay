import { execFile } from "node:child_process";

/**
 * Rejects when the tool is missing, timed out or ran out of room: only an
 * answer may say nobody is connected. `nothingFound` is the exit code that
 * means no matches.
 */
function run(file: string, args: string[], nothingFound?: number) {
  return new Promise<string>((resolve, reject) => {
    execFile(
      file,
      args,
      {
        maxBuffer: 16 << 20,
        timeout: 5000,
        windowsHide: true,
        env: { ...process.env, LC_ALL: "C" },
      },
      (e, out) =>
        !e || (e.code === nothingFound && !e.killed)
          ? resolve(out ?? "")
          : reject(e),
    );
  });
}

/** Both ends' ports of `lsof -Fn`'s established connections. */
export function lsofConnected(out: string): number[] {
  return out.split("\n").flatMap((line) => {
    const m = /^n.*:(\d+)->.*:(\d+)$/.exec(line);
    return m ? [+m[1]!, +m[2]!] : [];
  });
}

/**
 * Both ends' ports of `netstat -ano`'s connected TCP rows. The state's name is
 * translated on non-English Windows: listening rows have remote port 0, and
 * closed ones waiting out TIME_WAIT belong to pid 0.
 */
export function netstatConnected(out: string): number[] {
  return out.split(/\r?\n/).flatMap((row) => {
    const m = /^\s*TCP\s+\S*:(\d+)\s+\S*:(\d+)\s+\S+\s+(\d+)\s*$/i.exec(row);
    return m && +m[2]! && +m[3]! ? [+m[1]!, +m[2]!] : [];
  });
}

/**
 * Which of `ports` something is connected to now, such as a browser tab's
 * keep-alive or hot-reload socket. Relay can't see requests to a server it
 * doesn't sit in front of, so this is how it tells one is still in use.
 */
export async function connectedPorts(ports: number[]): Promise<Set<number>> {
  if (!ports.length) return new Set();
  const found =
    process.platform === "win32"
      ? netstatConnected(await run("netstat", ["-ano"]))
      : lsofConnected(
          await run("lsof", [
            "-nP",
            ...ports.map((port) => `-iTCP:${port}`),
            "-sTCP:ESTABLISHED",
            "-Fn",
          ], 1),
        );
  return new Set(found.filter((port) => ports.includes(port)));
}
