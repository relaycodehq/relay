import { expect, it } from "vitest";
import { leadStoppedLast } from "./lead-halted";
import type { ChatMessage } from "../../../shared/projects";

const message = (
  id: string,
  role: ChatMessage["role"],
  status: ChatMessage["status"] = "complete",
  patch: Partial<ChatMessage> = {},
): ChatMessage => ({
  id,
  role,
  status,
  body: "",
  created: 0,
  provider: "claude",
  version: 1,
  ...patch,
});
const request = message("request", "user");
const lead = message("lead", "assistant", "cancelled");

it("offers the lead's resume while the answer it stopped on is the latest", () => {
  expect(leadStoppedLast([request, lead], "lead")).toBe(true);
  expect(
    leadStoppedLast([request, message("lead", "assistant", "failed")], "lead"),
  ).toBe(true);
});

it("follows a resumed lead that stopped again to its newest answer", () => {
  const again = message("again", "assistant", "cancelled");
  expect(leadStoppedLast([request, lead, again], "again")).toBe(true);
  // Running again after the resume: nothing to resume yet.
  expect(
    leadStoppedLast(
      [request, lead, message("again", "assistant", "streaming")],
      "lead",
    ),
  ).toBe(false);
});

it("hides it once a later message or answer follows", () => {
  const asked = message("ask", "user");
  expect(leadStoppedLast([request, lead, asked], "lead")).toBe(false);
  expect(
    leadStoppedLast(
      [request, lead, asked, message("next", "assistant", "cancelled")],
      "lead",
    ),
  ).toBe(false);
  expect(
    leadStoppedLast(
      [request, lead, asked, message("next", "assistant")],
      "lead",
    ),
  ).toBe(false);
});

it("ignores side conversations, which don't move the main one on", () => {
  expect(
    leadStoppedLast(
      [
        request,
        lead,
        message("btw", "user", "complete", { side: true }),
        message("btw-answer", "assistant", "complete", { parentId: "btw" }),
        message("reply", "user", "complete", { parentId: "lead" }),
      ],
      "lead",
    ),
  ).toBe(true);
});

it("reads an older save's first lead answer when the review didn't record one", () => {
  expect(leadStoppedLast([request, lead], undefined)).toBe(true);
  expect(leadStoppedLast([request], undefined)).toBe(false);
  expect(
    leadStoppedLast([request, message("lead", "assistant")], undefined),
  ).toBe(false);
});
