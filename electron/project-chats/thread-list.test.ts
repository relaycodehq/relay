import { expect, it } from "vitest";
import { ThreadList } from "./thread-list";
import type { ChatCore } from "./core";
import type { ChatSummary } from "../../shared/projects";

it("counts blocking requests from helpers even when the parent keeps running", () => {
  const parent: ChatSummary = {
    id: "parent",
    projectId: "p",
    title: "Parent",
    scope: { kind: "review" },
    created: 1,
    updated: 1,
    asking: true,
    reviewing: true,
  };
  const helper: ChatSummary = {
    ...parent,
    id: "helper",
    reviewing: undefined,
    asking: undefined,
    reviewer: { parent: "parent", slot: 0 },
    startedBy: { chatId: "parent", agent: "claude" },
  };
  let blocked = false;
  const running = new Map([
    ["parent", { started: 1, requests: { list: () => [] } }],
    ["helper", { started: 2, requests: { list: () => (blocked ? [{}] : []) } }],
  ]);
  const core = {
    store: { get: () => ({ chats: [parent, helper], autoSettleDays: null }) },
    projects: { get: () => ({ settings: {} }) },
    active: running,
    sessions: { pending: () => [] },
  } as unknown as ChatCore;
  const threads = new ThreadList(core);
  const review = () => threads.list("p").find((c) => c.id === "parent")!;
  expect(review()).toMatchObject({ running: true, waiting: true });
  expect(review().blocked).toBeUndefined();
  blocked = true;
  expect(review().blocked).toBe(true);
  // The reviewer is listed too, under its review, and blocked on its own.
  expect(threads.list("p").find((c) => c.id === "helper")).toMatchObject({
    running: true,
    blocked: true,
  });
  // Once the lead has the reports, a reviewer at work is its own business.
  parent.reviewing = undefined;
  expect(review().blocked).toBeUndefined();
  parent.reviewing = true;
  running.clear();
  expect(review()).toMatchObject({ waiting: true });
  expect(review().running).toBeUndefined();
  parent.sentTo = { state: "away" } as ChatSummary["sentTo"];
  expect(review().waiting).toBeUndefined();
});
