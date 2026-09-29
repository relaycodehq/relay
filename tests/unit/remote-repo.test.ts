import { describe, expect, it } from "vitest";
import { isRemoteOf, remoteUrl, repoOf } from "../../electron/repository";

describe("repoOf", () => {
  it("reads owner and name from https and scp-style remotes", () => {
    expect(
      repoOf(remoteUrl("https://git.example.com/Web/web-store.git")!),
    ).toEqual({
      owner: "Web",
      name: "web-store",
    });
    expect(
      repoOf(remoteUrl("git@git.example.com:Web/web-store.git")!),
    ).toEqual({
      owner: "Web",
      name: "web-store",
    });
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
      isRemoteOf(
        "git@git.example.com:Web/Web-Store",
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
