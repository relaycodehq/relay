import {
  type AgentProvider,
  agentInfo,
} from "../../shared/agents";
import {
  type Exec,
  findExecutable,
  runExecutable,
} from "../platform/executables";

/**
 * Sign-ins finished in a browser on another computer (`away`): the one that
 * typed it into this computer's shell. A login that waits for the browser to
 * call back to this computer's localhost would never hear from it.
 */
const awayLogins: Partial<Record<AgentProvider, string>> = {
  codex: "login --device-auth",
};

/**
 * The line that signs the same CLI Relay runs back in. Typed into the
 * thread's shell for the user to run: the login stays the agent's own flow
 * and Relay never sees the token. Undefined for an agent that signs in
 * through Relay instead.
 */
export async function signInCommand(
  provider: AgentProvider,
  { away = false }: { away?: boolean } = {},
) {
  const login = (away && awayLogins[provider]) || agentInfo(provider).login;
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

/** What a CLI says when asked whether it's signed in, and how to read it. */
const statusChecks: Partial<
  Record<AgentProvider, { args: string[]; read: (run: Exec) => boolean | null }>
> = {
  claude: {
    args: ["auth", "status"],
    read: ({ stdout }) => {
      try {
        const { loggedIn } = JSON.parse(stdout) as { loggedIn?: unknown };
        return typeof loggedIn === "boolean" ? loggedIn : null;
      } catch {
        return null;
      }
    },
  },
  codex: {
    args: ["login", "status"],
    read: ({ code, output }) =>
      code === 0 ? true : /Not logged in/i.test(output) ? false : null,
  },
};

/** Whether the agent's CLI here is signed in; null when it can't tell. */
export async function agentSignedIn(
  provider: AgentProvider,
): Promise<boolean | null> {
  const check = statusChecks[provider];
  if (!check) return null;
  try {
    const run = await runExecutable(
      await findExecutable(provider),
      check.args,
      15_000,
    );
    return run.timedOut ? null : check.read(run);
  } catch {
    return null;
  }
}
