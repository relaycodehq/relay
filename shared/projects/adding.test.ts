import { expect, it } from "vitest";
import { parseRemote, repoName, slug } from "./adding";

it("reads clone URLs from any host and owner/repo as GitHub", () => {
  expect(parseRemote("https://github.com/acme/web.git")).toMatchObject({
    host: "github.com",
    full: "acme/web",
  });
  expect(parseRemote("git@gitlab.com:acme/platform/api.git")).toMatchObject({
    host: "gitlab.com",
    full: "acme/platform/api",
  });
  expect(parseRemote("ssh://git@git.example.com:2222/team/app")).toMatchObject({
    host: "git.example.com",
    full: "team/app",
  });
  expect(parseRemote(" acme/web ")).toEqual({
    host: "github.com",
    full: "acme/web",
    url: "https://github.com/acme/web.git",
  });
});

it("leaves paths, words and half-typed remotes alone", () => {
  for (const text of [
    "~/work/acme",
    "/Users/you/acme",
    "./acme/web",
    "acme",
    "acme/",
    "a b/c",
    "https://github.com/acme",
  ])
    expect(parseRemote(text), text).toBeNull();
});

it("names the clone's folder after the repository", () => {
  expect(repoName("acme/platform/api.git")).toBe("api");
});

it("makes a folder name from what was typed", () => {
  expect(slug("  My New App! ")).toBe("my-new-app");
  expect(slug("..hidden")).toBe("hidden");
});
