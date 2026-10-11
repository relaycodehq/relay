import type { ProjectChatEvent } from "../../shared/events";
import type { Projects } from "../projects/projects";
import type { Store } from "../app/store";
import type { ActiveTurns } from "./active";
import type { ThreadControl } from "./control";
import type { ProviderSessions } from "./sessions";
import type { ChatStorage } from "./storage";
import type { WatchSpendLog } from "./watch-spend";
import type { ProjectChat } from "../../shared/projects";
import type { HandoffLive } from "../../shared/handoff";

/** A live handoff's state as the other computer last said it, its running turn's start on this clock. */
export type AwayLive = Omit<HandoffLive, "runningFor"> & {
  runningSince?: number;
};

/** What every part of a project's threads shares; one of each per `ProjectChats`. */
export interface ChatCore {
  store: Store;
  projects: Projects;
  storage: ChatStorage;
  sessions: ProviderSessions;
  active: ActiveTurns;
  control: ThreadControl;
  emit: (event: ProjectChatEvent) => void;
  /** Relay is closing; nothing new starts. */
  closing: () => boolean;
  /** What runs and waits in threads a live handoff took to another computer, by chat id; absent in tests. */
  away?: Map<string, AwayLive>;
  /** What "Flag what I'd miss" spent; absent in tests. */
  watchSpend?: WatchSpendLog;
  previewLinks?: {
    note(chat: ProjectChat): Promise<string | undefined>;
    answer(chat: ProjectChat, body: string): Promise<string>;
  };
}
