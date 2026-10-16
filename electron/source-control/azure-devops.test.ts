import { expect, it } from "vitest";
import { parseAzAccount } from "./azure-devops";

const run = (code: number | null, stdout: string, stderr = "") => ({
  code,
  stdout,
  output: stdout + stderr,
});

it("names the account az is signed in as", () => {
  expect(parseAzAccount(run(0, "ann@example.com\n"))).toEqual({
    signIn: "signed-in",
    account: "ann@example.com",
  });
});

it("reads az asking for a login as signed out", () => {
  // With no login, and once the refresh token expired.
  for (const stderr of [
    "ERROR: Please run 'az login' to setup account.\n",
    "ERROR: AADSTS700082: The refresh token has expired due to inactivity.\nInteractive authentication is needed. Please run:\naz login --scope 499b84ac-1321-427f-aa17-267ca6975798/.default\n",
  ])
    expect(parseAzAccount(run(1, "", stderr))).toEqual({
      signIn: "signed-out",
      detail: "Run `az login` in a terminal to sign in.",
    });
});

it("doesn't claim a sign-in or sign-out it can't tell", () => {
  expect(parseAzAccount({ ...run(null, ""), timedOut: true })).toEqual({
    signIn: "unknown",
    detail: "`az` didn't answer in time.",
  });
  const broken = parseAzAccount(
    run(1, "", "ERROR: The command failed with an unexpected error.\n"),
  );
  expect(broken).toEqual({
    signIn: "unknown",
    detail: "ERROR: The command failed with an unexpected error.",
  });
  // A clean exit without a name is no proof of a login.
  expect(parseAzAccount(run(0, "\n")).signIn).toBe("unknown");
  expect(
    parseAzAccount(run(1, "", `${"x".repeat(500)}tail`)).detail,
  ).toHaveLength(300);
});
