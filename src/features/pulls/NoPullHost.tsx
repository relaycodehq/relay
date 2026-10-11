import { GitPullRequest } from "lucide-react";
import "./pull-requests.css";

/**
 * The Pull requests page with neither a `gh` login nor a Gitea account, or
 * with a `gh` login GitHub didn't answer for (`error`).
 */
export function NoPullHost({
  error,
  checking,
  onRecheck,
  onConnectGitea,
}: {
  error: string | null;
  checking: boolean;
  onRecheck: () => void;
  /** Absent while Gitea is off in Settings → Integrations. */
  onConnectGitea?: () => void;
}) {
  return (
    <main className="pulls-no-host">
      <GitPullRequest size={40} />
      {error ? (
        <>
          <h1>Couldn't reach GitHub</h1>
          <p>
            <code>gh</code> is signed in, but GitHub didn't answer: {error}
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
