import { expect, it } from "vitest";
import { claudeIdentity, codexIdentity } from "./identity";

it("reads Claude Code's account and plan from its config", () => {
  expect(
    claudeIdentity({
      oauthAccount: {
        emailAddress: "you@company.dev",
        organizationType: "claude_max",
      },
    }),
  ).toEqual({ signedIn: true, email: "you@company.dev", plan: "Max" });
  expect(claudeIdentity({ userID: "x" })).toEqual({ signedIn: false });
});

it("reads the account from Codex's id token without verifying it", () => {
  const claims = {
    email: "you@personal.dev",
    "https://api.openai.com/auth": { chatgpt_plan_type: "plus" },
  };
  const token = `h.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.s`;
  expect(codexIdentity({ tokens: { id_token: token } })).toEqual({
    signedIn: true,
    email: "you@personal.dev",
    plan: "Plus",
  });
  expect(codexIdentity({ OPENAI_API_KEY: "sk" })).toEqual({ signedIn: false });
});
