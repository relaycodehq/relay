import { Modal } from "../../ui/ui";

/** What a project needs before Relay can choose its PRs: a `gh` login, or Gitea. */
export function ConnectHost({
  github,
  checking,
  onRecheck,
  onConnectGitea,
  onClose,
}: {
  github: boolean;
  checking: boolean;
  onRecheck: () => void;
  onConnectGitea: () => void;
  onClose: () => void;
}) {
  return github ? (
    <Modal title="Sign in to GitHub" onClose={onClose}>
      <p>
        Relay reviews GitHub pull requests as the <code>gh</code> CLI’s login.
        Run <code>gh auth login</code> in a terminal, then check again.
      </p>
      <button disabled={checking} onClick={onRecheck}>
        {checking ? "Checking…" : "Check again"}
      </button>
    </Modal>
  ) : (
    <Modal title="No pull request host" onClose={onClose}>
      <p>
        Relay reviews pull requests on GitHub and Gitea. This folder has no
        github.com remote; if its remote is on Gitea, connect Gitea to match it.
      </p>
      <button onClick={onConnectGitea}>Connect Gitea</button>
    </Modal>
  );
}
