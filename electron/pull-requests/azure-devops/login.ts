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
    { at: number; client: Promise<AzureDevOps>; header?: string }
  >();

  constructor(
    private fetchRequest: FetchRequest,
    private tokens: AzureCliTokens,
  ) {}

  /**
   * The organization at `server`'s client, e.g. `https://dev.azure.com/org`.
   * A token other than the one it was connected with may be another `az`
   * login, so the client asks who it is again rather than act as the last.
   */
  async require(server: string) {
    const known = this.clients.get(server);
    if (known && Date.now() - known.at <= RECHECK) {
      const { header } = await this.tokens.token(server);
      const entry = this.clients.get(server);
      if (entry !== known || !known.header || known.header === header)
        return (entry ?? known).client;
    }
    return this.connect(server);
  }

  private connect(server: string) {
    const entry: { at: number; client: Promise<AzureDevOps>; header?: string } =
      { at: Date.now(), client: undefined! };
    const drop = () => {
      // A late refusal of an old client mustn't discard its replacement.
      if (this.clients.get(server) === entry) this.clients.delete(server);
    };
    entry.client = AzureDevOps.connect(
      server,
      async () => {
        const token = await this.tokens.token(server);
        entry.header ??= token.header;
        return token;
      },
      this.fetchRequest,
      drop,
    );
    this.clients.set(server, entry);
    entry.client.catch(drop);
    return entry.client;
  }

  /**
   * Who Relay acts as in the organization; null without an `az` login for
   * it. Throws when Azure DevOps didn't answer, so that isn't signed out.
   * Asks `az` afresh, so checking again picks up a login made since.
   */
  async account(server: string) {
    try {
      await this.tokens.renew(server);
      return (await this.require(server)).account;
    } catch (error) {
      if (error instanceof AzureCliSignedOut) return null;
      throw error;
    }
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
