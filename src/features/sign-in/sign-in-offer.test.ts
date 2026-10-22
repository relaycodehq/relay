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

it("connects OpenCode's providers in Relay's dialog", () => {
  expect(signInOffer("opencode")).toEqual({
    via: "opencode",
    label: "Sign in to OpenCode",
  });
});

it("signs Cursor in through Relay, which has no terminal command for it", () => {
  expect(signInOffer("cursor")).toEqual({
    via: "relay",
    label: "Sign in to Cursor",
  });
});

it("on a paired computer, types the login that finishes in a browser here", () => {
  expect(signInOffer("codex", { away: true })).toMatchObject({
    via: "terminal",
    command: "codex login --device-auth",
  });
  expect(signInOffer("claude", { away: true })).toMatchObject({
    command: "claude auth login",
  });
});

it("offers nothing on a paired computer that only Relay here could sign in", () => {
  expect(signInOffer("cursor", { away: true })).toBeUndefined();
  expect(signInOffer("opencode", { away: true })).toBeUndefined();
});
