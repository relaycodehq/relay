import { spawn } from "node:child_process";
import { gitEnv, gitExecutable, redactCredentials } from "../git/git";

/** How far a clone is, from one of the lines `git clone --progress` writes. */
export function cloneProgress(
  line: string,
): { step: string; progress: number | null } | null {
  const m = /^(?:remote: )?([A-Za-z ]+?):\s+(\d+)%/.exec(line.trim());
  if (!m) return null;
  const [, step, percent] = m;
  const at = Number(percent) / 100;
  // Receiving is most of the wait; the rest is quick by comparison.
  const span: Record<string, [number, number]> = {
    "Receiving objects": [0.05, 0.8],
    "Resolving deltas": [0.8, 0.95],
    "Updating files": [0.95, 1],
  };
  const [from, to] = span[step] ?? [0, 0.05];
  return { step, progress: from + (to - from) * at };
}

/** Clones `url` into `dest`, which must not exist yet. */
export async function cloneRepository(
  url: string,
  dest: string,
  options: {
    extraArgs: string[];
    onProgress: (step: string, progress: number | null) => void;
    signal: AbortSignal;
  },
) {
  const git = await gitExecutable();
  const env = gitEnv(
    // Without a terminal, ssh would wait on a host key or passphrase prompt forever.
    process.env.GIT_SSH_COMMAND
      ? {}
      : { GIT_SSH_COMMAND: "ssh -o BatchMode=yes" },
  );
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      git,
      [...options.extraArgs, "clone", "--progress", "--", url, dest],
      {
        env,
        stdio: ["ignore", "ignore", "pipe"],
        windowsHide: true,
        signal: options.signal,
      },
    );
    let tail = "";
    let partial = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      tail = (tail + chunk).slice(-4000);
      // Progress rewrites its line with \r; each piece is a reading.
      const parts = (partial + chunk).split(/[\r\n]/);
      partial = parts.pop() ?? "";
      for (const part of parts) {
        const read = cloneProgress(part);
        if (read) options.onProgress(read.step, read.progress);
      }
    });
    child.once("error", (e) =>
      reject(options.signal.aborted ? new Error("Cancelled.") : e),
    );
    child.once("close", (code) => {
      if (options.signal.aborted) return reject(new Error("Cancelled."));
      if (code === 0) return resolve();
      const said = redactCredentials(tail)
        .split(/[\r\n]/)
        .filter((l) => l.trim() && !cloneProgress(l))
        .slice(-4)
        .join("\n");
      reject(
        new Error(
          /could not read Username|Authentication failed|Permission denied \(publickey\)/i.test(
            said,
          )
            ? `Git couldn't sign in to clone it. ${said}`
            : said || `git clone exited with ${code}.`,
        ),
      );
    });
  });
}
