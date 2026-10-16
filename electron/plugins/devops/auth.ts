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

  /** Drops the `az` token when settings change or Azure rejects it. */
  forget() {
    this.generation++;
    this.cli.forget();
  }

  async credential(
    kind: DevOpsSettings["auth"],
    base: string,
  ): Promise<DevOpsCredential> {
    if (kind === "azure-cli") {
      const token = await this.cli.token(base);
      return { kind, header: token.header, rejected: token.rejected };
    }
    const pat = await this.pat();
    if (!pat)
      throw new Error(
        "Add a personal access token for Azure DevOps in Settings.",
      );
    const generation = this.generation;
    // A saved PAT is never deleted for being refused.
    return {
      kind,
      header: `Basic ${Buffer.from(":" + pat).toString("base64")}`,
      rejected: () => generation === this.generation,
    };
  }
}
