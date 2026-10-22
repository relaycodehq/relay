import { expect, it } from "vitest";
import { signInOffer } from "./sign-in-offer";

it("signs CLI agents in at their own login in the terminal", () => {
  expect(signInOffer("claude")).toEqual({
    via: "terminal",
    label: "Sign in to Claude in the terminal",
    command: "claude auth login",
  });
  expect(signInOffer("codex")).toMatchObject({
    via: "terminal",
    command: "codex login",
  });
});

it("connects OpenCode's providers inside Relay", () => {
  expect(signInOffer("opencode")).toEqual({
    via: "relay",
    label: "Sign in to OpenCode",
  });
});

it("signs Cursor in through Relay, which has no terminal command for it", () => {
  expect(signInOffer("cursor")).toEqual({
    via: "relay",
    label: "Sign in to Cursor",
  });
});
