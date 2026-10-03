import { findExecutable } from "../../platform/executables";

/** Claude rejected the account's login: it expired, or was revoked elsewhere. */
export class ClaudeSignedOutError extends Error {
  constructor() {
    super("Claude is signed out. Sign in again, then resume the answer.");
    this.name = "ClaudeSignedOutError";
  }
}

/**
 * The line that signs the same `claude` Relay runs back in. Typed into the
 * thread's shell for the user to run: the login stays Anthropic's own flow
 * and Relay never sees the token.
 */
export async function claudeSignInCommand() {
  const executable = await findExecutable("claude");
  if (process.platform === "win32") {
    const quoted = `'${executable.replace(/'/g, "''")}'`;
    const js = /\.[cm]?js$/i.test(executable);
    return `& ${js ? `node ${quoted}` : quoted} auth login`;
  }
  const quoted = /^[\w@%+=:,./-]+$/.test(executable)
    ? executable
    : `'${executable.replace(/'/g, `'\\''`)}'`;
  return `${quoted} auth login`;
}
