import { execFile } from "node:child_process";
import { promisify } from "node:util";
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
  text.replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/g, "$1[redacted]@");
export async function git(
  root: string,
  args: string[],
  timeout = 15000,
): Promise<string> {
  try {
    return (
      await exec("git", ["-C", root, ...args], {
        timeout,
        maxBuffer: 16 * 1024 * 1024,
        env: gitEnv(),
        encoding: "utf8",
      })
    ).stdout;
  } catch (e) {
    const error = e as Error & { stderr?: string };
    throw new Error(
      redactCredentials(error.stderr || error.message).slice(0, 3000),
    );
  }
}
export async function gitBytes(root: string, args: string[]) {
  return (
    await exec("git", ["-C", root, ...args], {
      timeout: 15000,
      maxBuffer: 2 * 1024 * 1024 + 4096,
      encoding: "buffer",
      env: gitEnv(),
    })
  ).stdout;
}
