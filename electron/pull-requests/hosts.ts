import {
  GITHUB_SERVER,
  hostKindOf,
  hostOffMessage,
  isSourceControlOn,
  urlHostKind,
  type SourceControlKind,
  type SourceControlSettings,
} from "../../shared/source-control";
import type { Account } from "../../shared/types";
import { parseAzurePullUrl, parseGithubPullUrl } from "../../shared/validation";
import type { GiteaLogin } from "../app/login";
import type { AzureLogin } from "./azure-devops/login";
import type { GithubLogin } from "./github-login";
import type { PullHost } from "./host";

/**
 * Every host Relay reviews pull requests on, picked by a repository's
 * server: github.com through `gh`, an Azure DevOps organization through
 * `az`, and any other server through the connected Gitea account.
 */
export class PullHosts {
  constructor(
    readonly gitea: GiteaLogin,
    readonly github: GithubLogin,
    readonly azure: AzureLogin,
    private settings: () => SourceControlSettings | undefined,
  ) {}

  private requireOn(kind: SourceControlKind) {
    if (!isSourceControlOn(this.settings(), kind))
      throw new Error(hostOffMessage(kind));
  }

  /**
   * The client for `server`'s pull requests; throws when there's no sign-in
   * for it. A ref saved before refs named their server is the Gitea account's.
   */
  async require(server: string | undefined): Promise<PullHost> {
    switch (hostKindOf(server)) {
      case "github":
        return this.github.require();
      case "azure-devops":
        this.requireOn("azure-devops");
        return this.azure.require(server!);
      default:
        return this.gitea.require();
    }
  }

  /** The client for `server` if it's signed in, without signing in or throwing. */
  async current(server: string | undefined): Promise<PullHost | null> {
    return hostKindOf(server) === "gitea"
      ? this.gitea.client
      : this.require(server).catch(() => null);
  }

  /** An Azure DevOps organization's client, for its Pipelines; null when off or signed out. */
  async azureClient(server: string) {
    if (!isSourceControlOn(this.settings(), "azure-devops")) return null;
    return this.azure.require(server).catch(() => null);
  }

  /**
   * What a repository on `server` keys saved review progress and linked
   * folders by: the site for GitHub and Azure, which needs no network to
   * know, and the account for Gitea, whose server can change hands.
   */
  accountKey(server: string) {
    return hostKindOf(server) === "gitea"
      ? this.gitea.require().account.id
      : server;
  }

  /** Who Relay acts as on `server`; null without a sign-in for it. */
  async account(server: string): Promise<Account | null> {
    switch (hostKindOf(server)) {
      case "github":
        return this.github.account();
      case "azure-devops":
        this.requireOn("azure-devops");
        return this.azure.account(server);
      default:
        return this.gitea.client?.account ?? null;
    }
  }

  /** A PR link as a ref on its host: the site says which, else it's Gitea's. */
  parseUrl(url: string) {
    switch (urlHostKind(linkTarget(url))) {
      case "github":
        return parseGithubPullUrl(url);
      case "azure-devops":
        return parseAzurePullUrl(url);
      default:
        return this.gitea.require().parseUrl(url);
    }
  }

  /**
   * The servers whose pull requests the Pull requests page gathers. GitHub's
   * switch only stops its CI, so GitHub is always asked.
   */
  boardServers(azureServers: string[]) {
    return [
      GITHUB_SERVER,
      ...(this.gitea.client ? [this.gitea.client.account.server] : []),
      ...(isSourceControlOn(this.settings(), "azure-devops")
        ? azureServers
        : []),
    ];
  }
}

/** The address a `relay:` link opens, or the link itself. */
function linkTarget(url: string) {
  try {
    const u = new URL(url);
    return u.protocol === "relay:" ? (u.searchParams.get("url") ?? url) : url;
  } catch {
    return url;
  }
}
