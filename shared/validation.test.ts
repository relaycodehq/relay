import { describe, expect, it } from "vitest";
import {
  isSitePullUrl,
  parseAzurePullUrl,
  parseGithubPullUrl,
} from "./validation";

const wrapped = (url: string) => `relay://open?url=${encodeURIComponent(url)}`;
const ref = {
  owner: "Sample Project",
  name: "web-store",
  number: 42,
  server: "https://dev.azure.com/sample-org",
};

describe("parseAzurePullUrl", () => {
  it("reads PR links on dev.azure.com and visualstudio.com as a ref on the organization", () => {
    for (const url of [
      "https://dev.azure.com/sample-org/Sample%20Project/_git/web-store/pullrequest/42",
      "https://dev.azure.com/Sample-Org/Sample%20Project/_git/web-store/pullrequest/42",
      "https://sample-org.visualstudio.com/Sample%20Project/_git/web-store/pullrequest/42",
      "https://sample-org.visualstudio.com/DefaultCollection/Sample%20Project/_git/web-store/pullrequest/42",
    ])
      expect(parseAzurePullUrl(url), url).toEqual(ref);
  });

  it("takes a repository named like its project, which links leave out, as in that project", () => {
    const own = { ...ref, owner: "web-store" };
    for (const url of [
      "https://dev.azure.com/sample-org/_git/web-store/pullrequest/42",
      "https://sample-org.visualstudio.com/_git/web-store/pullrequest/42",
      "https://sample-org.visualstudio.com/DefaultCollection/_git/web-store/pullrequest/42",
    ])
      expect(parseAzurePullUrl(url), url).toEqual(own);
  });

  it("reads a link to the PR's files or another tab", () => {
    for (const url of [
      "https://dev.azure.com/sample-org/Sample%20Project/_git/web-store/pullrequest/42/files",
      "https://dev.azure.com/sample-org/Sample%20Project/_git/web-store/pullrequest/42?_a=files",
      "https://dev.azure.com/sample-org/Sample%20Project/_git/web-store/pullRequest/42?_a=files&path=/src/app.ts",
      wrapped(
        "https://dev.azure.com/sample-org/Sample%20Project/_git/web-store/pullrequest/42?_a=files",
      ),
    ])
      expect(parseAzurePullUrl(url), url).toEqual(ref);
  });

  it("turns down links that aren't to one PR", () => {
    for (const url of [
      "https://dev.azure.com/sample-org/Sample%20Project/_git/web-store",
      "https://dev.azure.com/sample-org/Sample%20Project/_git/web-store/pullrequests",
      "https://dev.azure.com/sample-org/Sample%20Project/_git/web-store/pullrequest/new",
      "https://dev.azure.com/sample-org/Sample%20Project/_git/web-store/commit/abc123",
      "https://dev.azure.com/sample-org/Sample%20Project/_workitems/edit/42",
      "https://github.com/o/r/pull/42",
      "https://git.example.com/Sample/_git/web-store/pullrequest/42",
      "https://dev.azure.com/sample-org/p/_git/r%E0/pullrequest/1",
      "not a url",
    ])
      expect(() => parseAzurePullUrl(url), url).toThrow(
        "Paste an Azure DevOps pull request URL.",
      );
  });
});

describe("links whose site names their host", () => {
  it("knows GitHub and Azure DevOps links, wrapped or not, and leaves the rest to Gitea", () => {
    for (const url of [
      "https://github.com/o/r/pull/12",
      "https://dev.azure.com/sample-org/p/_git/r/pullrequest/1",
      "https://sample-org.visualstudio.com/p/_git/r/pullrequest/1",
      wrapped("https://dev.azure.com/sample-org/p/_git/r/pullrequest/1"),
    ])
      expect(isSitePullUrl(url), url).toBe(true);
    for (const url of [
      "https://git.example.com/Web/web-store/pulls/7",
      wrapped("https://git.example.com/Web/web-store/pulls/7"),
      "not a url",
    ])
      expect(isSitePullUrl(url), url).toBe(false);
  });

  it("parses each by its own site", () => {
    expect(
      parseGithubPullUrl(wrapped("https://github.com/o/r/pull/12")),
    ).toEqual({
      owner: "o",
      name: "r",
      number: 12,
      server: "https://github.com",
    });
    expect(
      parseAzurePullUrl(
        wrapped(
          "https://sample-org.visualstudio.com/Sample%20Project/_git/web-store/pullrequest/42",
        ),
      ),
    ).toEqual(ref);
  });
});
