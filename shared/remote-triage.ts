import { triageState } from "./chat-activity";
import type { ChatSummary, ChatTriage } from "./projects";
import type { RemoteChatSummary } from "./remote";

/**
 * Takes back a settle or snooze made from a phone, as the desktop's ⌘Z does.
 * A phone's list doesn't carry every mark (`unsettledAt`, `archivedAt`), so
 * those come from what the desktop answered: settling and snoozing leave them
 * alone, and only the marks the phone does see go back.
 */
export function undoTriage(
  before: Pick<RemoteChatSummary, "settledAt" | "snoozedAt" | "snoozedUntil">,
  after: ChatSummary,
): ChatTriage {
  const from = triageState(after);
  const { unsettledAt, archivedAt } = from;
  return {
    kind: "restore",
    from,
    to: {
      ...(unsettledAt ? { unsettledAt } : {}),
      ...(archivedAt ? { archivedAt } : {}),
      ...(before.settledAt ? { settledAt: before.settledAt } : {}),
      ...(before.snoozedUntil
        ? { snoozedAt: before.snoozedAt, snoozedUntil: before.snoozedUntil }
        : {}),
    },
  };
}
