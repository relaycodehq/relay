import type { ProjectChatEvent } from "../../shared/events";
import type { Projects } from "../projects/projects";
import type { Store } from "../app/store";
import type { ActiveTurns } from "./active";
import type { ThreadControl } from "./control";
import type { ProviderSessions } from "./sessions";
import type { ChatStorage } from "./storage";
import type { WatchSpendLog } from "./watch-spend";

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
  /** What "Flag what I'd miss" spent; absent in tests. */
  watchSpend?: WatchSpendLog;
}
