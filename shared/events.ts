import type { DeviceHubState } from "./devices";
import type { AddingJob, ChatMessage, ChatSummary } from "./projects";
import type { PreviewReveal, PreviewState } from "./preview";
import type { ReadAloudEvent, ReadAloudState } from "./read-aloud";
import type { PlaySoundEvent } from "./sounds";
import type {
  MainWindowCommand,
  ThreadWindow,
  ThreadWindowsState,
} from "./thread-windows";

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
  "relay:thread-windows": ThreadWindowsState;
  /** Show this thread in the main window, as one popped out goes back. */
  "relay:open-thread": ThreadWindow;
  /** This thread's own window was brought up; it lights its edges to be found. */
  "relay:flash-window": null;
  /** Run this command in the main window, asked from a thread's own. */
  "relay:main-command": MainWindowCommand;
  "relay:device-hub": DeviceHubState;
  "relay:shared-draft": import("./drafts").DraftChange;
  "relay:draft-send": import("./drafts").HeldSend;
  /** A menu or crash prompt wants the report page; `takeBugReportWanted` says if it still does. */
  "relay:bug-report": null;
  /** Something changed in this place's folder that its working tree may show. */
  "relay:working-tree": string;
  /** What this thread and those it started changed in other repositories may read differently. */
  "relay:elsewhere": string;
}
