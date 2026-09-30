/** The hosts Relay talks to for a repository's pull requests and CI. */
export const sourceControlKinds = ["github", "gitea"] as const;
export type SourceControlKind = (typeof sourceControlKinds)[number];

export const sourceControlNames: Record<SourceControlKind, string> = {
  github: "GitHub",
  gitea: "Gitea",
};

/** What Settings keeps: hosts the user turned off, and the `gh` they linked. */
export interface SourceControlSettings {
  off?: SourceControlKind[];
  paths?: { github?: string };
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
  /** The command-line tool Relay runs; absent for a host Relay reaches with an account. */
  cli?: string;
  /** The program Relay runs; absent when none was found. */
  path?: string;
  /** Set when the user linked `path` instead of leaving it to Relay. */
  linked?: boolean;
  /** As the tool or server prints it, e.g. `gh version 2.101.0`. */
  version?: string;
  signIn: SourceControlSignIn;
  /** Who Relay acts as. */
  account?: string;
  /** What the user can do about it, or why Relay couldn't tell. */
  detail?: string;
}

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
