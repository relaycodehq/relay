import { describe, expect, it } from "vitest";
import {
  credentialPassword,
  isSourceControlOn,
  parseGhAuth,
  parseTeaLogins,
} from "./source-control";

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

describe("reading tea", () => {
  // From `tea logins list --output json`, tea 0.16.0.
  const list = JSON.stringify([
    {
      name: "work",
      url: "https://git.example.com",
      user: "ann",
      default: "false",
    },
    {
      name: "home",
      url: "http://127.0.0.1:3000",
      user: "ann",
      default: "true",
    },
    { url: "https://no-name.example.com" },
  ]);

  it("lists logins with the default first and skips broken entries", () => {
    expect(parseTeaLogins(list).map((l) => l.name)).toEqual(["home", "work"]);
    expect(parseTeaLogins(list)[0]).toMatchObject({ default: true });
  });

  it("treats anything that isn't a list as no logins", () => {
    expect(parseTeaLogins("No logins yet")).toEqual([]);
    expect(parseTeaLogins("{}")).toEqual([]);
  });

  it("takes the token from a credential helper's answer", () => {
    expect(
      credentialPassword(
        "protocol=https\nhost=git.example.com\nusername=ann\npassword=s3cret\n",
      ),
    ).toBe("s3cret");
    expect(
      credentialPassword("protocol=https\nhost=git.example.com\n"),
    ).toBeUndefined();
  });
});
