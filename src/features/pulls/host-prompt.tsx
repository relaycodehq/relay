import type { ReactNode } from "react";
import {
  hostOffMessage,
  sourceControlNames,
  type SourceControlKind,
} from "../../../shared/source-control";

const command = (text: string) => <code className="cli-command">{text}</code>;
const signIns: Partial<Record<SourceControlKind, ReactNode>> = {
  github: (
    <>
      Relay reviews GitHub pull requests as the <code>gh</code> CLI’s login. Run{" "}
      {command("gh auth login")} in a terminal, then check again.
    </>
  ),
  "azure-devops": (
    <>
      Relay reviews Azure DevOps pull requests as the Azure CLI’s login. Run{" "}
      {command("az login")} in a terminal, then check again.
    </>
  ),
};

/**
 * What a project needs before Relay can reach its pull requests: a CLI
 * login for GitHub and Azure DevOps, or a Gitea account for any other remote.
 */
export function hostPrompt({
  kind,
  error,
  checking,
  onRecheck,
  onConnectGitea,
}: {
  kind: SourceControlKind | null;
  /** The CLI is signed in but its host didn't answer, or the host is off. */
  error: string | null;
  checking: boolean;
  onRecheck: () => void;
  /** Absent while Gitea is off in Settings → Integrations. */
  onConnectGitea?: () => void;
}): { title: string; text: ReactNode; action?: ReactNode } {
  const recheck = (
    <button disabled={checking} onClick={onRecheck}>
      {checking ? "Checking…" : "Check again"}
    </button>
  );
  // Turning it back on refreshes the account, so there's nothing to recheck.
  if (kind && kind !== "gitea" && error === hostOffMessage(kind))
    return {
      title: `${sourceControlNames[kind]} is off`,
      text: (
        <p>
          Turn it on in Settings → Integrations to review its pull requests
          here.
        </p>
      ),
    };
  if (kind && kind !== "gitea")
    return {
      title: `${error ? "Can't reach" : "Sign in to"} ${sourceControlNames[kind]}`,
      text: <p>{error ?? signIns[kind]}</p>,
      action: recheck,
    };
  return onConnectGitea
    ? {
        title: "No pull request host",
        text: (
          <p>
            Relay reviews pull requests on GitHub, Azure DevOps and Gitea. This
            folder has no GitHub or Azure DevOps remote; if its remote is on
            Gitea, connect Gitea to match it.
          </p>
        ),
        action: <button onClick={onConnectGitea}>Connect Gitea</button>,
      }
    : {
        title: "No pull request host",
        text: (
          <p>
            Relay reviews pull requests on GitHub and Azure DevOps, and on Gitea
            once it's on in Settings → Integrations. This folder has no GitHub
            or Azure DevOps remote.
          </p>
        ),
      };
}

/** The same, in a pane with room for its heading. */
export function HostPrompt(props: Parameters<typeof hostPrompt>[0]) {
  const { title, text, action } = hostPrompt(props);
  return (
    <>
      <h2>{title}</h2>
      {text}
      {action}
    </>
  );
}
