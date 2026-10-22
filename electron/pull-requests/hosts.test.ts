import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SourceControlSettings } from "../../shared/source-control";
import type { GiteaLogin } from "../app/login";
import type { AzureLogin } from "./azure-devops/login";
import type { GithubLogin } from "../github/login";
import { PullHosts } from "./hosts";

const org = "https://dev.azure.com/sample-org";
const giteaServer = "https://git.example.com/gitea";
const azureLink =
  "https://sample-org.visualstudio.com/Sample%20Project/_git/web-store/pullrequest/42";
const wrapped = (url: string) => `relay://open?url=${encodeURIComponent(url)}`;

const githubClient = { name: "github" };
const azureClient = { name: "azure" };
const giteaClient = {
  name: "gitea",
  account: { id: "gitea-account", server: giteaServer },
  parseUrl: vi.fn(() => ({ owner: "Web", name: "web-store", number: 7 })),
};

let settings: SourceControlSettings | undefined;
let gitea: { client: typeof giteaClient | null; require(): typeof giteaClient };
let github: {
  require: ReturnType<typeof vi.fn>;
  account: ReturnType<typeof vi.fn>;
};
let azure: {
  require: ReturnType<typeof vi.fn>;
  account: ReturnType<typeof vi.fn>;
};
let hosts: PullHosts;

beforeEach(() => {
  settings = undefined;
  giteaClient.parseUrl.mockClear();
  gitea = {
    client: giteaClient,
    require() {
      if (!this.client) throw new Error("Connect your Gitea account first.");
      return this.client;
    },
  };
  github = {
    require: vi.fn(async () => githubClient),
    account: vi.fn(async () => ({ id: "https://github.com" })),
  };
  azure = {
    require: vi.fn(async () => azureClient),
    account: vi.fn(async (server: string) => ({ id: server })),
  };
  hosts = new PullHosts(
    gitea as unknown as GiteaLogin,
    github as unknown as GithubLogin,
    azure as unknown as AzureLogin,
    () => settings,
  );
});

describe("picking a repository's host by its server", () => {
  it("sends github.com to gh, an Azure organization to az, and the rest to Gitea", async () => {
    expect(await hosts.require("https://github.com")).toBe(githubClient);
    expect(await hosts.require(org)).toBe(azureClient);
    expect(azure.require).toHaveBeenCalledWith(org);
    expect(await hosts.require(giteaServer)).toBe(giteaClient);
    // Refs saved before refs named their server are the Gitea account's.
    expect(await hosts.require(undefined)).toBe(giteaClient);
    // Only an organization's own server is Azure's.
    expect(await hosts.require(`${org}/Sample%20Project`)).toBe(giteaClient);
  });

  it("turns Azure DevOps down while it's off in Settings, without asking az", async () => {
    settings = { off: ["azure-devops"] };
    const off = "Azure DevOps is off in Settings → Integrations.";
    await expect(hosts.require(org)).rejects.toThrow(off);
    await expect(hosts.account(org)).rejects.toThrow(off);
    expect(await hosts.current(org)).toBeNull();
    expect(await hosts.azureClient(org)).toBeNull();
    expect(azure.require).not.toHaveBeenCalled();
    expect(azure.account).not.toHaveBeenCalled();
    // The other hosts carry on.
    expect(await hosts.require("https://github.com")).toBe(githubClient);
  });

  it("gives no current client where there's no sign-in, without throwing", async () => {
    azure.require.mockRejectedValue(new Error("Run `az login`"));
    expect(await hosts.current(org)).toBeNull();
    expect(await hosts.azureClient(org)).toBeNull();
    gitea.client = null;
    expect(await hosts.current(giteaServer)).toBeNull();
    expect(await hosts.current("https://github.com")).toBe(githubClient);
  });
});

it("asks each host who Relay is there", async () => {
  expect(await hosts.account("https://github.com")).toEqual({
    id: "https://github.com",
  });
  expect(await hosts.account(org)).toEqual({ id: org });
  expect(azure.account).toHaveBeenCalledWith(org);
  expect(await hosts.account(giteaServer)).toBe(giteaClient.account);
  gitea.client = null;
  expect(await hosts.account(giteaServer)).toBeNull();
});

it("keys GitHub and Azure repositories by their site and Gitea's by the account", () => {
  expect(hosts.accountKey("https://github.com")).toBe("https://github.com");
  expect(hosts.accountKey(org)).toBe(org);
  expect(hosts.accountKey(giteaServer)).toBe("gitea-account");
  gitea.client = null;
  expect(() => hosts.accountKey(giteaServer)).toThrow(/Gitea/);
  // Neither GitHub nor Azure needs a sign-in to know theirs.
  expect(hosts.accountKey(org)).toBe(org);
});

describe("parseUrl", () => {
  it("reads GitHub and Azure DevOps links by their site, wrapped or not", () => {
    const github = {
      owner: "o",
      name: "r",
      number: 12,
      server: "https://github.com",
    };
    const azure = {
      owner: "Sample Project",
      name: "web-store",
      number: 42,
      server: org,
    };
    expect(hosts.parseUrl("https://github.com/o/r/pull/12")).toEqual(github);
    expect(hosts.parseUrl(wrapped("https://github.com/o/r/pull/12"))).toEqual(
      github,
    );
    expect(hosts.parseUrl(azureLink)).toEqual(azure);
    expect(hosts.parseUrl(wrapped(azureLink))).toEqual(azure);
    expect(giteaClient.parseUrl).not.toHaveBeenCalled();
  });

  it("leaves any other link to the Gitea account", () => {
    const link = `${giteaServer}/Web/web-store/pulls/7`;
    expect(hosts.parseUrl(wrapped(link))).toEqual({
      owner: "Web",
      name: "web-store",
      number: 7,
    });
    expect(giteaClient.parseUrl).toHaveBeenCalledWith(wrapped(link));
    gitea.client = null;
    expect(() => hosts.parseUrl(link)).toThrow(/Gitea/);
  });
});

it("gathers the board from GitHub always, Gitea when connected and Azure when on", () => {
  const organizations = [org, "https://dev.azure.com/other-org"];
  expect(hosts.boardServers(organizations)).toEqual([
    "https://github.com",
    giteaServer,
    ...organizations,
  ]);
  gitea.client = null;
  settings = { off: ["azure-devops", "github"] };
  expect(hosts.boardServers(organizations)).toEqual(["https://github.com"]);
});
