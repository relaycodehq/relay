import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { NotText, textLimit, tooLarge } from "./working-files";
const exec = promisify(execFile);
/** Git never prompts, takes optional locks, or reads paths as patterns. */
export const gitEnv = (extra?: NodeJS.ProcessEnv): NodeJS.ProcessEnv => ({
  ...process.env,
  GIT_TERMINAL_PROMPT: "0",
  GIT_OPTIONAL_LOCKS: "0",
  GIT_LITERAL_PATHSPECS: "1",
  GCM_INTERACTIVE: "never",
  ...extra,
});
/** Git may include credential-bearing remote URLs in output and failures. */
export const redactCredentials = (text: string) =>
  // A token often stands alone in the user name.
  text.replace(/(https?:\/\/)[^\s/@]+@/g, "$1[redacted]@");
export interface GitOptions {
  /** Milliseconds; 15 s unless set. */
  timeout?: number;
  maxBuffer?: number;
  /** Added over `gitEnv`. */
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
}
/** Git's failure as the user should see it: its own message, no credentials. */
function gitError(e: unknown) {
  const error = e as Error & { stderr?: string | Buffer };
  return new Error(
    redactCredentials(String(error.stderr || "") || error.message).slice(
      0,
      3000,
    ),
  );
}
/** Runs Git in `root`; a timeout as a number is the common case. */
export async function git(
  root: string,
  args: string[],
  options: number | GitOptions = {},
): Promise<string> {
  const {
    timeout = 15000,
    maxBuffer = 16 * 1024 * 1024,
    env,
    signal,
  } = typeof options === "number" ? { timeout: options } : options;
  try {
    return (
      await exec("git", ["-C", root, ...args], {
        timeout,
        maxBuffer,
        env: gitEnv(env),
        encoding: "utf8",
        signal,
      })
    ).stdout;
  } catch (e) {
    throw gitError(e);
  }
}
/** Git's output as bytes, up to `limit`; past it, the content isn't text Relay shows. */
export async function gitBytes(
  root: string,
  args: string[],
  limit = textLimit,
) {
  try {
    return (
      await exec("git", ["-C", root, ...args], {
        timeout: 15000,
        maxBuffer: limit + 4096,
        encoding: "buffer",
        env: gitEnv(),
      })
    ).stdout;
  } catch (e) {
    // The buffer stops just past the limit.
    if (
      (e as NodeJS.ErrnoException).code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER"
    )
      throw new NotText(tooLarge);
    throw gitError(e);
  }
}
