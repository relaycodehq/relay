/** The hosts Relay talks to for a repository's pull requests, CI and work items. */
export const sourceControlKinds = ["github", "gitea", "azure-devops"] as const;
export type SourceControlKind = (typeof sourceControlKinds)[number];

export const sourceControlNames: Record<SourceControlKind, string> = {
  github: "GitHub",
  gitea: "Gitea",
  "azure-devops": "Azure DevOps",
};

/** What Settings keeps: hosts the user turned off, and the CLIs they linked. */
export interface SourceControlSettings {
  off?: SourceControlKind[];
  paths?: Partial<Record<SourceControlKind, string>>;
}

export const isSourceControlOn = (
  settings: SourceControlSettings | undefined,
  kind: SourceControlKind,
) => !settings?.off?.includes(kind);

export type SourceControlSignIn = "signed-in" | "signed-out" | "unknown";

/** One host as Relay last found it. */
export interface SourceControlProvider {
  kind: SourceControlKind;
  name: string;
  enabled: boolean;
  /** The command-line tool Relay runs. */
  cli?: string;
  /** The program Relay runs; absent when none was found. */
  path?: string;
  /** Set when the user linked `path` instead of leaving it to Relay. */
  linked?: boolean;
  /** The tool's version, e.g. `2.101.0`. */
  version?: string;
  signIn: SourceControlSignIn;
  /** Who Relay acts as. */
  account?: string;
  /** The server `account` is on, for a host that isn't one site, e.g. `git.example.com`. */
  server?: string;
  /** One more sentence: what to do about it, or why Relay couldn't tell. */
  detail?: string;
  /** The one thing to do in Relay: link the CLI, sign in, or set the host up. */
  fix?: SourceControlFix;
}

/**
 * `connect` opens the Gitea sign-in; the rest open the host's details.
 * `set-up` means Relay has nothing to go on yet, so the host can't be on.
 */
export type SourceControlFix = "link" | "connect" | "sign-in" | "set-up";

export interface GhSignIn {
  signIn: SourceControlSignIn;
  account?: string;
  detail?: string;
}

/**
 * What `gh auth status --hostname github.com` says. Newer releases print
 * "Logged in to github.com account NAME", older ones "... as NAME"; a login
 * whose token was revoked is reported as failed.
 */
export function parseGhAuth(output: string, code: number | null): GhSignIn {
  const text = output.replace(/\u001b\[[0-9;]*m/g, "");
  const account = /Logged in to \S+ (?:account|as) (\S+)/.exec(text)?.[1];
  if (code === 0 && account) return { signIn: "signed-in", account };
  if (/Failed to log in|token .* is invalid|authentication failed/i.test(text))
    return {
      signIn: "signed-out",
      detail: "The saved login was rejected. Run `gh auth login` again.",
    };
  if (/not logged in/i.test(text))
    return {
      signIn: "signed-out",
      detail: "Run `gh auth login` in a terminal to sign in.",
    };
  return {
    signIn: "unknown",
    detail: "`gh auth status` gave an answer Relay doesn't recognise.",
  };
}

/** A server `tea` is logged in to; its token stays in the main process. */
export interface TeaLogin {
  name: string;
  url: string;
  user: string;
  default: boolean;
}

export interface TeaSetup {
  /** The `tea` program; absent when none was found. */
  path?: string;
  linked?: boolean;
  version?: string;
  logins: TeaLogin[];
  /** Why `tea` couldn't be used, e.g. that it won't say its version. */
  error?: string;
}

/** The logins in `tea logins list --output json`, the default one first. */
export function parseTeaLogins(output: string): TeaLogin[] {
  let list: unknown;
  try {
    list = JSON.parse(output);
  } catch {
    return [];
  }
  if (!Array.isArray(list)) return [];
  return list
    .flatMap((entry: Record<string, unknown>) =>
      typeof entry?.name === "string" && typeof entry.url === "string"
        ? [
            {
              name: entry.name,
              url: entry.url,
              user: typeof entry.user === "string" ? entry.user : "",
              default: entry.default === "true" || entry.default === true,
            },
          ]
        : [],
    )
    .sort((a, b) => Number(b.default) - Number(a.default));
}

/** The token line of what a git credential helper prints for a `get`. */
export const credentialPassword = (output: string) =>
  /^password=(.+)$/m.exec(output)?.[1].trim() || undefined;
