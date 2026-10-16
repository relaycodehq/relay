import type { DevOpsSettings } from "../../../shared/devops";
import { AzureCliTokens } from "../../azure-devops/cli-token";
import type { DevOpsCredential, Fetch } from "./client";

/** The Authorization header for the chosen sign-in: the PAT, or the `az` login. */
export class DevOpsAuth {
  private cli: AzureCliTokens;
  /** Bumped by `forget`, so a refusal of the old PAT can't clear what the new one loaded. */
  private generation = 0;

  constructor(
    fetch: Fetch,
    private pat: () => Promise<string | undefined>,
    /** Shared with Azure DevOps pull requests, so `az` runs once for both. */
    cli?: AzureCliTokens,
  ) {
    this.cli = cli ?? new AzureCliTokens(fetch);
  }

  /**
   * After the settings changed: refusals from before no longer count. The
   * `az` tokens, shared with pull requests, go only when the sign-in itself
   * changed, not for a sort order or a hidden project.
   */
  forget({ signIn }: { signIn: boolean }) {
    this.generation++;
    if (signIn) this.cli.forget();
  }

  async credential(
    kind: DevOpsSettings["auth"],
    base: string,
  ): Promise<DevOpsCredential> {
    // Before anything is awaited, so a refusal can't clear a newer setup's caches.
    const generation = this.generation;
    if (kind === "azure-cli") {
      const token = await this.cli.token(base);
      return {
        kind,
        header: token.header,
        rejected: () => generation === this.generation && token.rejected(),
      };
    }
    const pat = await this.pat();
    if (!pat)
      throw new Error(
        "Add a personal access token for Azure DevOps in Settings.",
      );
    // A saved PAT is never deleted for being refused.
    return {
      kind,
      header: `Basic ${Buffer.from(":" + pat).toString("base64")}`,
      rejected: () => generation === this.generation,
    };
  }
}
