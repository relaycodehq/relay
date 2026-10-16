import { describe, expect, it } from "vitest";
import {
  azureRepoOf,
  isRemoteOf,
  isRemoteOfRepo,
  remoteUrl,
  repoOf,
  siteRepoOf,
} from "./repository";

describe("repoOf", () => {
  it("reads owner and name from https and scp-style remotes", () => {
    expect(
      repoOf(remoteUrl("https://git.example.com/Web/web-store.git")!),
    ).toEqual({
      owner: "Web",
      name: "web-store",
    });
    expect(repoOf(remoteUrl("git@git.example.com:Web/web-store.git")!)).toEqual(
      {
        owner: "Web",
        name: "web-store",
      },
    );
  });

  it("takes the last two segments when the host serves under a prefix", () => {
    expect(
      repoOf(remoteUrl("https://example.com/git/Web/portal.git/")!),
    ).toEqual({
      owner: "Web",
      name: "portal",
    });
  });

  it("gives nothing when there's no owner", () => {
    expect(repoOf(remoteUrl("https://example.com/portal.git")!)).toBeNull();
  });
});

describe("isRemoteOf", () => {
  const repo = { owner: "Web", name: "Web-Store" };

  it("matches the repository on its host whatever the case or .git suffix", () => {
    expect(
      isRemoteOf(
        "https://git.example.com/web/web-store.git",
        "git.example.com",
        repo,
      ),
    ).toBe(true);
    expect(
      isRemoteOf("git@git.example.com:Web/Web-Store", "git.example.com", repo),
    ).toBe(true);
  });

  it("takes an SSH remote whose host isn't the web address, but not an HTTP one", () => {
    for (const raw of [
      "git@ssh.git.example.com:Web/Web-Store.git",
      "git@work-gitea:Web/Web-Store.git",
      "ssh://git@git.example.com:2222/Web/Web-Store.git",
    ])
      expect(isRemoteOf(raw, "git.example.com", repo)).toBe(true);
    expect(
      isRemoteOf(
        "https://ssh.git.example.com/Web/Web-Store",
        "git.example.com",
        repo,
      ),
    ).toBe(false);
  });

  it("compares hosts without case", () => {
    expect(
      isRemoteOf(
        "https://Git.Example.com/Web/Web-Store",
        "git.example.com",
        repo,
      ),
    ).toBe(true);
    expect(
      isRemoteOf(
        "ssh://git@GIT.example.com/Web/Web-Store",
        "git.example.com",
        repo,
      ),
    ).toBe(true);
  });

  it("rejects another host, another repository, and things that aren't URLs", () => {
    expect(
      isRemoteOf(
        "https://other.example.com/Web/Web-Store",
        "git.example.com",
        repo,
      ),
    ).toBe(false);
    expect(
      isRemoteOf("https://git.example.com/Web/other", "git.example.com", repo),
    ).toBe(false);
    expect(isRemoteOf("", "git.example.com", repo)).toBe(false);
  });
});

describe("Azure DevOps remotes", () => {
  const repo = {
    server: "https://dev.azure.com/sample-org",
    owner: "Sample Project",
    name: "web-store",
  };

  it("reads the organization, project and repository from every form Azure hands out", () => {
    for (const raw of [
      "https://dev.azure.com/sample-org/Sample%20Project/_git/web-store",
      "https://sample-org@dev.azure.com/sample-org/Sample%20Project/_git/web-store",
      "git@ssh.dev.azure.com:v3/sample-org/Sample%20Project/web-store",
      "sample-org@vs-ssh.visualstudio.com:v3/sample-org/Sample%20Project/web-store",
      "https://sample-org.visualstudio.com/Sample%20Project/_git/web-store",
      "https://sample-org.visualstudio.com/DefaultCollection/Sample%20Project/_git/web-store",
      "https://dev.azure.com/sample-org/Sample%20Project/_git/_optimized/web-store",
      "https://sample-org.visualstudio.com/Sample%20Project/_git/_full/web-store",
    ])
      expect(siteRepoOf(raw), raw).toEqual(repo);
  });

  it("keeps one server per organization whatever its case", () => {
    expect(
      siteRepoOf(
        "https://dev.azure.com/Sample-Org/Sample%20Project/_git/web-store",
      )?.server,
    ).toBe(repo.server);
    expect(
      siteRepoOf(
        "git@ssh.dev.azure.com:v3/SAMPLE-ORG/Sample%20Project/web-store",
      )?.server,
    ).toBe(repo.server);
    expect(
      siteRepoOf(
        "https://Sample-Org.VisualStudio.com/Sample%20Project/_git/web-store",
      )?.server,
    ).toBe(repo.server);
  });

  it("names the project after the repository when the path has none", () => {
    for (const raw of [
      "https://dev.azure.com/sample-org/_git/web-store",
      "https://sample-org.visualstudio.com/_git/web-store",
      "https://sample-org.visualstudio.com/DefaultCollection/_git/web-store",
    ])
      expect(siteRepoOf(raw), raw).toEqual({
        server: repo.server,
        owner: "web-store",
        name: "web-store",
      });
  });

  it("isn't fooled by remotes that only look like Azure's", () => {
    for (const raw of [
      "https://dev.azure.com/sample-org/Sample%20Project",
      "https://dev.azure.com/_git/web-store",
      "git@ssh.dev.azure.com:sample-org/Sample%20Project/web-store",
      "git@ssh.dev.azure.com:v3/sample-org/web-store",
      "https://git.example.com/sample-org/Sample%20Project/_git/web-store",
    ])
      expect(azureRepoOf(remoteUrl(raw)!), raw).toBeNull();
  });

  it("reads GitHub remotes by their site and leaves Gitea's to the account", () => {
    expect(siteRepoOf("git@github.com:relaycodehq/relay.git")).toEqual({
      server: "https://github.com",
      owner: "relaycodehq",
      name: "relay",
    });
    expect(siteRepoOf("https://git.example.com/Web/web-store.git")).toBeNull();
  });

  it("matches a remote to an Azure repository by organization, project and name, without case", () => {
    expect(
      isRemoteOfRepo(
        "git@ssh.dev.azure.com:v3/Sample-Org/sample%20project/Web-Store",
        repo.server,
        repo,
      ),
    ).toBe(true);
    expect(
      isRemoteOfRepo(
        "https://dev.azure.com/other-org/Sample%20Project/_git/web-store",
        repo.server,
        repo,
      ),
    ).toBe(false);
    expect(
      isRemoteOfRepo(
        "https://dev.azure.com/sample-org/Other/_git/web-store",
        repo.server,
        repo,
      ),
    ).toBe(false);
    // The repository's last two segments aren't project/name on Azure.
    expect(
      isRemoteOfRepo(
        "https://git.example.com/Sample%20Project/web-store",
        repo.server,
        repo,
      ),
    ).toBe(false);
  });

  it("still matches GitHub and Gitea remotes by host", () => {
    expect(
      isRemoteOfRepo(
        "git@github.com:relaycodehq/relay.git",
        "https://github.com",
        {
          owner: "relaycodehq",
          name: "relay",
        },
      ),
    ).toBe(true);
    expect(
      isRemoteOfRepo(
        "https://git.example.com/Web/web-store.git",
        "https://git.example.com/gitea",
        { owner: "Web", name: "web-store" },
      ),
    ).toBe(true);
  });
});
