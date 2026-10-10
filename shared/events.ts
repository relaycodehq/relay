import type { AddingJob, ChatMessage, ChatSummary } from "./projects";
import type { PreviewReveal, PreviewState } from "./preview";
import type { ReadAloudEvent, ReadAloudState } from "./read-aloud";
import type { PlaySoundEvent } from "./sounds";

/** A thread's message as it streams or changes; `title` once the thread is named. */
export interface ProjectChatEvent {
  chatId: string;
  message: ChatMessage;
  title?: string;
}

/** A project's thread list, as `projectChats` returns it, whenever it reads differently. */
export interface ProjectChatsEvent {
  projectId: string;
  chats: ChatSummary[];
}

/** What the main process pushes to the window, by channel. */
export interface RelayEvents {
  "relay:project-chat": ProjectChatEvent;
  "relay:project-chats": ProjectChatsEvent;
  "relay:read-aloud": ReadAloudEvent;
  "relay:read-aloud-state": ReadAloudState;
  "relay:project-adding": AddingJob | null;
  "relay:preview": PreviewState;
  "relay:preview-reveal": PreviewReveal;
  "relay:play-sound": PlaySoundEvent;
}
