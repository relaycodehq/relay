import { afterEach, expect, it, vi } from "vitest";
import { GitHub, GithubSignedOut } from "./github";
import { GithubLogin } from "./github-login";

afterEach(() => vi.restoreAllMocks());

const login = () =>
  new GithubLogin(async () => new Response("{}", { status: 500 }));

it("reads no `gh` login as signed out", async () => {
  vi.spyOn(GitHub, "connect").mockRejectedValue(new GithubSignedOut());
  await expect(login().account()).resolves.toBeNull();
});

it("doesn't pass a GitHub that didn't answer off as signed out", async () => {
  vi.spyOn(GitHub, "connect").mockRejectedValue(new Error("fetch failed"));
  await expect(login().account()).rejects.toThrow("fetch failed");
});
