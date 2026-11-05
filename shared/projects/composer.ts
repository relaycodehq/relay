import type { ProjectChat } from "./chat";
import { replyRoots, threadOrder, type ChatMessage } from "./messages";
import { sentSettingsOf, type ResumeSettings } from "./send";

export type SentComposerSettings = ResumeSettings & { id: string };

/** The latest send in this conversation, independent of another branch's lastInput. */
export function lastComposerSettings(
  chat: ProjectChat | undefined,
  rootId?: string,
): SentComposerSettings | undefined {
  if (!chat) return;
  const messages = [...chat.messages].sort(threadOrder);
  return lastSentIn(messages, replyRoots(messages), chat.lastInput, rootId);
}

/**
 * lastComposerSettings over messages already in thread order, with their
 * reply roots: an open thread has both, and asks on every streamed piece.
 */
export function lastSentIn(
  messages: readonly ChatMessage[],
  roots: ReadonlyMap<string, string>,
  last: ProjectChat["lastInput"],
  rootId?: string,
): SentComposerSettings | undefined {
  // Older threads kept only one input, shared by all their conversations.
  // It is useful only in the conversation it actually went to.
  const legacy =
    last && (last.side ? last.id : (last.parentId ?? undefined)) === rootId
      ? sentSettingsOf(last)
      : undefined;
  const lastMessage = messages.find((m) => m.id === last?.id);
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (legacy && lastMessage === message) return { ...legacy, id: last!.id };
    if (message.role !== "user" || !message.sentSettings) continue;
    const conversation = message.side
      ? message.id
      : message.parentId
        ? roots.get(message.id)
        : undefined;
    if (conversation === rootId)
      return { ...message.sentSettings, id: message.id };
  }
  // A review lead's initial request has no user message of its own.
  return legacy ? { ...legacy, id: last!.id } : undefined;
}
