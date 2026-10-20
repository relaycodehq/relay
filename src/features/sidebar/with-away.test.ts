import { expect, it } from "vitest";
import type { ChatSentTo, HandoffView } from "../../../shared/handoff";
import type { ChatSummary } from "../../../shared/projects";
import { withAway } from "./with-away";

const sentTo = (s: Partial<ChatSentTo> = {}) =>
  ({ id: "h", computer: "Ubuntu", state: "away", ...s }) as ChatSentTo;
const chat = (s: ChatSentTo) =>
  ({ id: "c", updated: 1, waiting: false, sentTo: s }) as ChatSummary;
const view = (s: ChatSentTo, online = true): HandoffView => ({
  sentTo: s,
  online,
  remote: {
    title: "A thread",
    running: true,
    runningSince: 5,
    waiting: false,
    settled: false,
    updated: 9,
    returned: false,
    provider: "claude",
  },
});

it("shows a thread handed off the old way as running where the other computer runs it", () => {
  const old = sentTo();
  const card = withAway(chat(old), view(old));
  expect(card).toMatchObject({
    running: true,
    runningSince: 5,
    updated: 9,
    runningAgents: ["claude"],
  });
});

it("leaves a live one, and one on a computer that's offline, as listed", () => {
  const live = sentTo({ live: true });
  expect(withAway(chat(live), view(live))).toEqual(chat(live));
  const old = sentTo();
  expect(withAway(chat(old), view(old, false))).toEqual(chat(old));
});
