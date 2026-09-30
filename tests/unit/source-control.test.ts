import { describe, expect, it } from "vitest";
import { isSourceControlOn, parseGhAuth } from "../../shared/source-control";

describe("reading gh auth status", () => {
  it("finds the account in newer and older output", () => {
    const now = `github.com\n  ✓ Logged in to github.com account octocat (keyring)\n  - Active account: true`;
    const before = `github.com\n  ✓ Logged in to github.com as octocat (oauth_token)`;
    expect(parseGhAuth(now, 0)).toEqual({
      signIn: "signed-in",
      account: "octocat",
    });
    expect(parseGhAuth(before, 0)).toMatchObject({ account: "octocat" });
  });

  it("ignores colour codes gh adds in a terminal", () => {
    const out = "\u001b[32m✓\u001b[0m Logged in to github.com account octocat";
    expect(parseGhAuth(out, 0).account).toBe("octocat");
  });

  it("tells a rejected login from no login", () => {
    const rejected =
      "github.com\n  X Failed to log in to github.com account octocat (keyring)\n  - The token in keyring is invalid.";
    expect(parseGhAuth(rejected, 1).detail).toMatch(/rejected/);
    expect(
      parseGhAuth("You are not logged into any GitHub hosts.", 1),
    ).toMatchObject({ signIn: "signed-out" });
  });

  it("doesn't claim a sign-in it can't read", () => {
    expect(parseGhAuth("something new", 0).signIn).toBe("unknown");
    // A zero exit without an account name is not proof of a login.
    expect(parseGhAuth("Logged in", 0).signIn).toBe("unknown");
  });
});

it("treats every host as on until the user turns it off", () => {
  expect(isSourceControlOn(undefined, "github")).toBe(true);
  expect(isSourceControlOn({ off: ["gitea"] }, "github")).toBe(true);
  expect(isSourceControlOn({ off: ["gitea"] }, "gitea")).toBe(false);
});
