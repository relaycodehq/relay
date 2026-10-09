import type { AgentProvider } from "./agents";
import { replyRoots, threadOrder, type ChatMessage } from "./projects";

/**
 * The agent whose proposed plan still waits for a go-ahead in the open
 * conversation, if any. `view` is what that conversation shows, `messages` the
 * whole thread. The plan has to end the view, and nothing may have followed
 * it where it could have been acted on: later in its own conversation, or in
 * the replies under it. A side conversation rooted at the plan keeps it last
 * after the go-ahead went to the main one, so the view alone can't tell.
 */
export function openPlan(
  messages: ChatMessage[],
  view: ChatMessage[],
): AgentProvider | undefined {
  const plan = view.at(-1);
  if (plan?.status !== "complete" || !plan.proposedPlan) return undefined;
  const roots = replyRoots(messages);
  const line = (m: ChatMessage) => roots.get(m.id) ?? null;
  const planLine = line(plan);
  const followed = messages.some(
    (m) =>
      m.id !== plan.id &&
      threadOrder(m, plan) > 0 &&
      (line(m) === planLine || line(m) === plan.id),
  );
  return followed ? undefined : plan.provider;
}
