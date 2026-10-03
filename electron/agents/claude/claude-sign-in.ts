import { findExecutable } from "../../platform/executables";

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
