import { expect, it } from "vitest";
import { implementPlan } from "./compose-send";
import { mainConversation, replyRoots, type ChatMessage } from "./projects";
import { openPlan } from "./open-plan";

let seq = 0;
const message = (
  id: string,
  role: ChatMessage["role"],
  extra: Partial<ChatMessage> = {},
): ChatMessage => ({
  id,
  role,
  body: id,
  status: "complete",
  created: ++seq,
  seq,
  provider: "claude",
  version: 1,
  ...extra,
});

const other = message("other", "assistant");
const ask = message("ask", "user", { body: "@claude plan retries" });
const plan = message("plan", "assistant", { proposedPlan: true });
const goAhead = message("go", "user", { body: implementPlan("claude") });
const build = message("build", "assistant");

const sideOf = (messages: ChatMessage[], rootId: string) => {
  const roots = replyRoots(messages);
  return messages.filter((m) => m.id === rootId || roots.get(m.id) === rootId);
};

it("offers a fresh plan that ends the main conversation", () => {
  const thread = [ask, plan];
  expect(openPlan(thread, mainConversation(thread))).toBe("claude");
});

it("doesn't offer a plan again in its replies once the main conversation went ahead", () => {
  const thread = [ask, plan, goAhead, build];
  // The replies view rooted at the plan still ends on it.
  expect(sideOf(thread, plan.id).at(-1)).toBe(plan);
  expect(openPlan(thread, sideOf(thread, plan.id))).toBeUndefined();
  expect(openPlan(thread, mainConversation(thread))).toBeUndefined();
});

it("doesn't offer it while the go-ahead is the newest thing, before any answer", () => {
  const thread = [ask, plan, goAhead];
  expect(openPlan(thread, sideOf(thread, plan.id))).toBeUndefined();
});

it("doesn't offer a plan in the main conversation that was carried out in its replies", () => {
  const reply = message("reply-go", "user", {
    body: implementPlan("claude"),
    parentId: plan.id,
  });
  const thread = [ask, plan, reply];
  expect(openPlan(thread, mainConversation(thread))).toBeUndefined();
});

it("offers a plan proposed in a side conversation as that conversation's last word", () => {
  const root = message("root", "assistant");
  const question = message("q", "user", { parentId: root.id });
  const sidePlan = message("side-plan", "assistant", {
    parentId: question.id,
    proposedPlan: true,
  });
  // A later turn in the main conversation doesn't touch the side one.
  const later = message("later", "user");
  const thread = [root, question, sidePlan, later];
  expect(openPlan(thread, sideOf(thread, root.id))).toBe("claude");
});

it("leaves the main plan open beside an unrelated side conversation's newer replies", () => {
  const aside = message("aside", "user", { parentId: other.id });
  const thread = [other, ask, plan, aside];
  expect(openPlan(thread, mainConversation(thread))).toBe("claude");
});

it("offers nothing for an unfinished plan", () => {
  const streaming = { ...plan, status: "streaming" as const };
  expect(openPlan([ask, streaming], [ask, streaming])).toBeUndefined();
});
