import { GitPullRequest } from "lucide-react";
import { isAzureServer } from "../../../shared/source-control";
import "./pull-requests.css";

/**
 * The Pull requests page with no host signed in, or with a CLI login whose
 * host didn't answer (`error`).
 */
export function NoPullHost({
  servers,
  error,
  checking,
  onRecheck,
  onConnectGitea,
}: {
  /** The hosts the page would ask, for which CLIs to mention. */
  servers: string[];
  error: { host: string; message: string } | null;
  checking: boolean;
  onRecheck: () => void;
  /** Absent while Gitea is off in Settings → Integrations. */
  onConnectGitea?: () => void;
}) {
  // Azure DevOps comes up once a project is in one of its organizations.
  const azure = servers.some(isAzureServer);
  return (
    <main className="pulls-no-host">
      <GitPullRequest size={40} />
      {error ? (
        <>
          <h1>Couldn't reach {error.host}</h1>
          <p>
            Relay is signed in, but {error.host} didn't answer: {error.message}
          </p>
        </>
      ) : azure ? (
        <>
          <h1>Sign in to GitHub or Azure DevOps</h1>
          <p>
            Relay finds your pull requests through the <code>gh</code> and{" "}
            <code>az</code> CLIs. Run <code>gh auth login</code> or{" "}
            <code>az login</code> in a terminal, then check again.
          </p>
        </>
      ) : (
        <>
          <h1>Sign in to GitHub</h1>
          <p>
            Relay finds your GitHub pull requests through the <code>gh</code>{" "}
            CLI. Run <code>gh auth login</code> in a terminal, then check again.
          </p>
        </>
      )}
      <button className="primary" disabled={checking} onClick={onRecheck}>
        {checking ? "Checking…" : "Check again"}
      </button>
      {onConnectGitea && (
        <button className="text-button" onClick={onConnectGitea}>
          Or connect a Gitea server
        </button>
      )}
    </main>
  );
}
