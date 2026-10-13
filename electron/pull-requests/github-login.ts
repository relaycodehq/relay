import { GitHub, GithubSignedOut } from "./github";
import type { FetchRequest } from "./gitea";

/** How long a `gh` login is trusted before Relay asks `gh` again. */
const RECHECK = 5 * 60_000;

/** GitHub as the `gh` CLI is signed in to it; Relay keeps no GitHub token of its own. */
export class GithubLogin {
  private client: Promise<GitHub> | null = null;
  private at = 0;
  constructor(private fetchRequest: FetchRequest) {}
  /** Picks up a new `gh auth login`, or a sign-out, within a few minutes. */
  require() {
    if (!this.client || Date.now() - this.at > RECHECK) {
      this.at = Date.now();
      const next = GitHub.connect(this.fetchRequest, () => {
        // A late 401 from an old client mustn't discard its replacement.
        if (this.client === next) this.client = null;
      });
      this.client = next;
      next.catch(() => {
        if (this.client === next) this.client = null;
      });
    }
    return this.client;
  }
  /**
   * Who Relay acts as on GitHub; null without a `gh` login. Throws when `gh`
   * is signed in but GitHub didn't answer, so that isn't shown as signed out.
   */
  account() {
    return this.require().then(
      (c) => c.account,
      (error: unknown) => {
        if (error instanceof GithubSignedOut) return null;
        throw error;
      },
    );
  }
}
