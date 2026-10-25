import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { findExecutable } from "../platform/executables";

const exec = promisify(execFile);
const RECHECK_MS = 5 * 60_000;

/** Borrows the `gh` CLI's login; null when it has none. */
export async function ghToken() {
  try {
    const gh = await findExecutable("gh");
    const { stdout } = await exec(
      gh,
      ["auth", "token", "--hostname", "github.com"],
      { timeout: 5000, encoding: "utf8" },
    );
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

export interface GithubCredential {
  token: string | null;
  rejected(): void;
}

/** One owner for the CLI credential used by PRs and CI, including anonymous reads. */
export class GithubCredentials {
  private current?: Promise<GithubCredential>;
  private at = 0;
  constructor(private source: () => Promise<string | null> = ghToken) {}

  read() {
    if (!this.current || Date.now() - this.at >= RECHECK_MS) {
      this.at = Date.now();
      const next: Promise<GithubCredential> = this.source().then((token) => ({
        token,
        rejected: () => {
          if (this.current === next) this.forget();
        },
      }));
      this.current = next;
      void next.catch(() => {
        if (this.current === next) this.forget();
      });
    }
    return this.current;
  }

  isCurrent(credential: Promise<GithubCredential>) {
    return this.current === credential;
  }

  forget() {
    this.current = undefined;
  }
}
