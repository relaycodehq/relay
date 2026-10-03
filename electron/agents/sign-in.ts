import {
  agents,
  type AgentInfo,
  type AgentProvider,
} from "../../shared/agents";
import { findExecutable } from "../platform/executables";

/**
 * The line that signs the same CLI Relay runs back in. Typed into the
 * thread's shell for the user to run: the login stays the agent's own flow
 * and Relay never sees the token. Undefined for an agent that signs in
 * through Relay instead.
 */
export async function signInCommand(provider: AgentProvider) {
  const login = (agents[provider] as AgentInfo).login;
  if (!login) return;
  const executable = await findExecutable(provider);
  if (process.platform === "win32") {
    const quoted = `'${executable.replace(/'/g, "''")}'`;
    const js = /\.[cm]?js$/i.test(executable);
    return `& ${js ? `node ${quoted}` : quoted} ${login}`;
  }
  const quoted = /^[\w@%+=:,./-]+$/.test(executable)
    ? executable
    : `'${executable.replace(/'/g, `'\\''`)}'`;
  return `${quoted} ${login}`;
}
