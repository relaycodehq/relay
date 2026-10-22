import { triageState } from "../../shared/chat-activity";
import type { ChatSummary, ChatTriage } from "../../shared/projects";
import type { RemoteChatSummary } from "../../shared/remote";

/**
 * The Undo a phone sends after a settle or snooze; the phone apps build the
 * same in Kotlin and Swift. Takes it back as the desktop's ⌘Z does.
 * A phone's list doesn't carry every mark (`unsettledAt`, `archivedAt`), so
 * those come from what the desktop answered: settling and snoozing leave them
 * alone, and only the marks the phone does see go back.
 */
export function undoTriage(
  before: Pick<
    RemoteChatSummary,
    "settledAt" | "autoSettled" | "snoozedAt" | "snoozedUntil"
  >,
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
      ...(!before.autoSettled && before.settledAt
        ? { settledAt: before.settledAt }
        : {}),
      ...(before.snoozedUntil
        ? { snoozedAt: before.snoozedAt, snoozedUntil: before.snoozedUntil }
        : {}),
    },
  };
}
