import { GitHub, GithubSignedOut } from "../pull-requests/github";
import { GithubCredentials, type GithubCredential } from "./credentials";
import type { FetchRequest } from "../pull-requests/host";

/** GitHub as the `gh` CLI is signed in to it; Relay keeps no GitHub token of its own. */
export class GithubLogin {
  private client: Promise<GitHub> | null = null;
  private credential?: Promise<GithubCredential>;
  constructor(
    private fetchRequest: FetchRequest,
    readonly credentials = new GithubCredentials(),
  ) {}
  refresh() {
    this.credentials.forget();
    this.client = null;
  }
  /** Picks up a new `gh auth login`, or a sign-out, within a few minutes. */
  require() {
    const credential = this.credentials.read();
    if (!this.client || this.credential !== credential) {
      this.credential = credential;
      const next = credential.then(async (value) => {
        // An anonymous CI credential is useful, but a PR sign-in recheck must
        // be able to discover an external login on its next operation.
        if (!value.token) value.rejected();
        return GitHub.connect(this.fetchRequest, value);
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
