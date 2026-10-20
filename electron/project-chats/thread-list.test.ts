import { expect, it } from "vitest";
import { defaultPrefs } from "../settings";
import { ThreadList } from "./thread-list";
import type { ChatCore } from "./core";
import { ActiveTurns } from "./active";
import type { ChatSummary, ProjectChatSend } from "../../shared/projects";

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
  const running = new ActiveTurns(() => {});
  const input = { provider: "claude", body: "" } as ProjectChatSend;
  const held = [running.claim("parent", input), running.claim("helper", input)];
  const core = {
    store: { get: () => ({ chats: [parent, helper] }) },
    prefs: () => ({ ...defaultPrefs, autoSettleDays: null }),
    projects: { get: () => ({ settings: {} }) },
    active: running,
    sessions: { pending: () => [] },
  } as unknown as ChatCore;
  const threads = new ThreadList(core);
  const review = () => threads.list("p").find((c) => c.id === "parent")!;
  expect(review()).toMatchObject({ running: true, waiting: true });
  expect(review().blocked).toBeUndefined();
  // The reviewer's agent asks for approval.
  void held[1].requests
    .ask({ kind: "approval", title: "Run the checks?", decisions: ["accept"] })
    .catch(() => {});
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
  running.release("parent", held[0]);
  running.release("helper", held[1]);
  expect(review()).toMatchObject({ waiting: true });
  expect(review().running).toBeUndefined();
  parent.sentTo = { state: "away" } as ChatSummary["sentTo"];
  expect(review().waiting).toBeUndefined();
});
