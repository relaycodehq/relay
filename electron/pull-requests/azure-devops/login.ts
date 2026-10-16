import {
  AzureCliSignedOut,
  type AzureCliTokens,
} from "../../azure-devops/cli-token";
import type { FetchRequest } from "../host";
import { AzureDevOps } from "./client";

/** How long an organization's client is trusted before Relay asks who it is again. */
const RECHECK = 5 * 60_000;

/**
 * Azure DevOps as the `az` CLI is signed in to it, one client per
 * organization. Relay keeps no token of its own: each request asks the
 * shared `az` tokens, which pick up a new `az login` once one is refused.
 */
export class AzureLogin {
  private clients = new Map<
    string,
    { at: number; client: Promise<AzureDevOps> }
  >();
  constructor(
    private fetchRequest: FetchRequest,
    private tokens: AzureCliTokens,
  ) {}

  /** The organization at `server`'s client, e.g. `https://dev.azure.com/org`. */
  require(server: string) {
    const known = this.clients.get(server);
    if (known && Date.now() - known.at <= RECHECK) return known.client;
    const drop = () => {
      // A late refusal of an old client mustn't discard its replacement.
      if (this.clients.get(server)?.client === next)
        this.clients.delete(server);
    };
    const next = AzureDevOps.connect(
      server,
      () => this.tokens.token(server),
      this.fetchRequest,
      drop,
    );
    this.clients.set(server, { at: Date.now(), client: next });
    next.catch(drop);
    return next;
  }

  /**
   * Who Relay acts as in the organization; null without an `az` login for
   * it. Throws when Azure DevOps didn't answer, so that isn't signed out.
   */
  account(server: string) {
    return this.require(server).then(
      (c) => c.account,
      (error: unknown) => {
        if (error instanceof AzureCliSignedOut) return null;
        throw error;
      },
    );
  }

  /** Lets every organization go, as when Azure DevOps is turned off. */
  release() {
    for (const { client } of this.clients.values())
      void client.then(
        (c) => c.dispose(),
        () => {},
      );
    this.clients.clear();
  }
}
