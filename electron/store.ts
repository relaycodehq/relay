import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { Account, Progress, WorkspaceState } from "../shared/types";
import {
  aiSettingsSchema,
  defaultAISettings,
  type StoredAISettings,
} from "../shared/settings";
interface State {
  roomAccessConsents?: Record<string, boolean>;
  projects?: import("../shared/projects").Project[];
  /** Sidebar group paths, kept even while no project is in them. */
  projectGroups?: string[];
  /** Prettify automatic project names; unset keeps the original default (on). */
  smartProjectNames?: boolean;
  /** Legacy saves: automatic names were already title-cased by the old migration. */
  projectTitlesTidied?: true;
  /** Set once groups were dragged; `projectGroups` order is then the sidebar's. */
  projectGroupsOrdered?: true;
  sidebarView?: import("../shared/types").SidebarView;
  chats?: import("../shared/projects").ChatSummary[];
  roomHosting?: string;
  roomConnections?: Record<string, string>;
  roomJoins?: Record<string, string>;
  roomDeliveries?: Record<string, import("./rooms/service").RoomDelivery>;
  aiSettings?: StoredAISettings;
  /** The agent last picked for a new thread, on the desktop or the phone. */
  newThreadAgent?: import("../shared/agents").AgentProvider;
  /** Each agent's model a new thread starts on; see shared/new-thread-models. */
  newThreadModels?: import("../shared/new-thread-models").NewThreadModels;
  devops?: import("../shared/devops").DevOpsSettings;
  /** Encrypted with the OS credential store, like `encryptedToken`. */
  devopsPat?: string;
  devopsOpenRouterKey?: string;
  phoneRemote?: import("./remote/devices").RemoteSettings;
  /** The Git executable chosen in Settings; unset, Relay finds its own. */
  gitPath?: string;
  /** Agent CLIs linked in Settings; a missing one is found by searching. */
  agentPaths?: Partial<
    Record<import("../shared/agents").AgentProvider, string>
  >;
  /** Source control hosts turned off, and the `gh` linked in Settings. */
  sourceControl?: import("../shared/source-control").SourceControlSettings;
  version: 1;
  account?: Account;
  encryptedToken?: string;
  folders: Record<string, string>;
  progress: Record<string, Progress>;
  workspaces?: Record<string, WorkspaceState>;
}
export class Store {
  private state: State = { version: 1, folders: {}, progress: {} };
  private queue: Promise<void> = Promise.resolve();
  private writeError: unknown;
  async flush() {
    await this.queue;
    if (this.writeError) throw this.writeError;
  }
  constructor(private dir: string) {}
  async load() {
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    try {
      const parsed = JSON.parse(
        await readFile(join(this.dir, "state.json"), "utf8"),
      );
      if (parsed.version !== 1)
        throw new Error("Unsupported saved data version.");
      this.state = parsed;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT")
        throw new Error(
          "Saved review data could not be read. It has been preserved; restore state.json from backup before continuing.",
        );
    }
  }
  get() {
    return this.state;
  }
  /** The saved AI settings, filled in and checked, or the defaults. */
  aiSettings() {
    return aiSettingsSchema.parse(this.state.aiSettings ?? defaultAISettings);
  }
  async update(fn: (s: State) => void) {
    const task = this.queue.then(async () => {
      const next = structuredClone(this.state);
      fn(next);
      const tmp = join(this.dir, `state-${randomUUID()}.tmp`);
      await writeFile(tmp, JSON.stringify(next), { mode: 0o600 });
      await rename(tmp, join(this.dir, "state.json"));
      this.state = next;
      this.writeError = undefined;
    });
    this.queue = task.catch((error) => {
      this.writeError = error;
    });
    await task;
  }
}
