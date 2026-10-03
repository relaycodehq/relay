// Signs an account in with the CLI's own browser flow, run with the account's
// folder as its home. Relay never sees the token: the CLI saves it there.
import type { ChildProcess } from "node:child_process";
import type { AccountProvider } from "../../../shared/agent-accounts";
import { findExecutable, spawnExecutable } from "../../platform/executables";
import { terminate } from "../../platform/terminate";

const LOGIN: Record<AccountProvider, string[]> = {
  claude: ["auth", "login"],
  codex: ["login"],
};
/** Long enough to find the right browser window and pick an organisation. */
const TIMEOUT = 10 * 60_000;

export interface SignIn {
  done: Promise<void>;
  cancel(): void;
}

/** Starts the login; `done` settles when the CLI exits, rejecting with what it said. */
export async function startSignIn(
  provider: AccountProvider,
  env: Record<string, string>,
): Promise<SignIn> {
  const executable = await findExecutable(provider);
  const child: ChildProcess = spawnExecutable(executable, LOGIN[provider], {
    env,
    // No terminal: the CLI opens the browser and waits for its callback.
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let output = "",
    cancelled = false;
  const collect = (chunk: Buffer) => {
    output = (output + chunk.toString()).slice(-4000);
  };
  child.stdout?.on("data", collect);
  child.stderr?.on("data", collect);
  const timer = setTimeout(() => terminate(child), TIMEOUT);
  const done = new Promise<void>((resolve, reject) => {
    child.once("error", (e) => reject(e));
    child.once("exit", (code) => {
      clearTimeout(timer);
      if (cancelled) reject(new Error("Sign-in cancelled."));
      else if (code === 0) resolve();
      else reject(new Error(lastLine(output) || "The sign-in didn't finish."));
    });
  });
  return {
    done,
    cancel() {
      cancelled = true;
      terminate(child);
    },
  };
}

/** The CLI's last words, without its escape codes and the long URL. */
function lastLine(output: string) {
  return (
    output
      .replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)|\x1b\[[0-9;]*[a-zA-Z]/g, "")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !/https?:\/\//.test(line))
      .at(-1) ?? ""
  ).slice(0, 300);
}
