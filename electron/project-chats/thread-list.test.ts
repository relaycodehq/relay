import { expect, it } from "vitest";
import { ThreadList } from "./thread-list";
import type { ChatCore } from "./core";
import type { ChatSummary } from "../../shared/projects";

it("counts blocking requests from helpers even when the parent keeps running", () => {
  const parent: ChatSummary = {
    id: "parent",
    projectId: "p",
    title: "Parent",
    scope: { kind: "project" },
    created: 1,
    updated: 1,
    asking: true,
  };
  const helper = { ...parent, id: "helper", reviewer: { parent: "parent" } };
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
  expect(threads.list("p")[0]).toMatchObject({ running: true, waiting: true });
  expect(threads.list("p")[0].blocked).toBeUndefined();
  blocked = true;
  expect(threads.list("p")[0].blocked).toBe(true);
  running.clear();
  expect(threads.list("p")[0]).toMatchObject({ waiting: true });
  expect(threads.list("p")[0].running).toBeUndefined();
  parent.sentTo = { state: "away" } as ChatSummary["sentTo"];
  expect(threads.list("p")[0].waiting).toBeUndefined();
});
