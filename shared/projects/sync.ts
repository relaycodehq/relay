import { z } from "zod";
import type { ProjectChat } from "./chat";
import type { ChatMessage } from "./messages";

/** Message id → version the renderer already holds. */
export type KnownMessages = Record<string, number>;
export const knownMessagesSchema = z
  .record(z.string().max(200), z.number().int().nonnegative())
  .refine((known) => Object.keys(known).length <= 20000);
/** A chat where messages the caller already holds at the same version are sent as their ids. */
export interface ProjectChatPatch extends Omit<ProjectChat, "messages"> {
  messages: (ChatMessage | string)[];
}
/** Rebuilds a patched chat, reusing the previous message objects it only named. */
export function applyChatPatch(
  patch: ProjectChatPatch,
  previous: ProjectChat | undefined,
): ProjectChat {
  const held = new Map(previous?.messages.map((m) => [m.id, m]));
  return {
    ...patch,
    messages: patch.messages.map((m) => {
      if (typeof m !== "string") return m;
      const kept = held.get(m);
      if (!kept) throw new Error("Conversation update is missing a message.");
      return kept;
    }),
  };
}
