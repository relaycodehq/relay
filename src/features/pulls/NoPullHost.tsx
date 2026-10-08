import { GitPullRequest } from "lucide-react";
import "./pull-requests.css";

/** The Pull requests page with neither a `gh` login nor a Gitea account. */
export function NoPullHost({
  checking,
  onRecheck,
  onConnectGitea,
}: {
  checking: boolean;
  onRecheck: () => void;
  onConnectGitea: () => void;
}) {
  return (
    <main className="pulls-no-host">
      <GitPullRequest size={40} />
      <h1>No pull requests yet</h1>
      <p>
        Relay finds your GitHub pull requests through the <code>gh</code> CLI.
        Run <code>gh auth login</code> in a terminal, then check again.
      </p>
      <button className="primary" disabled={checking} onClick={onRecheck}>
        {checking ? "Checking…" : "Check again"}
      </button>
      <button className="text-button" onClick={onConnectGitea}>
        Or connect a Gitea server
      </button>
    </main>
  );
}
