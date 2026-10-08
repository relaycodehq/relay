import { readFile, writeFile, mkdir, rename, stat } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { Account, Progress, WorkspaceState } from "../../shared/types";
import {
  aiSettingsSchema,
  defaultAISettings,
  type StoredAISettings,
} from "../../shared/settings";
import type { RemoteSettings, SavedComputer } from "./store-types";

/** What pull request rooms saved, sealed room tokens among them; dropped on load. */
const roomKeys = [
  "roomAccessConsents",
  "roomHosting",
  "roomConnections",
  "roomJoins",
  "roomDeliveries",
];

interface State {
  projects?: import("../../shared/projects").Project[];
  /** Where the last clone or new project went; the add-project palette starts there. */
  projectsFolder?: string;
  /** Sidebar group paths, kept even while no project is in them. */
  projectGroups?: string[];
  /** Prettify automatic project names; unset keeps the original default (on). */
  smartProjectNames?: boolean;
  /** Keep the computer from idling to sleep while Relay runs; unset is on. */
  keepAwake?: boolean;
  /** Flag what I'd miss in Claude threads; unset is off. */
  watchThreads?: import("../../shared/watch").WatchScope;
  /** Topics the watcher was told are already known, newest last. */
  watchKnown?: string[];
  /** Legacy saves: automatic names were already title-cased by the old migration. */
  projectTitlesTidied?: true;
  /** Set once groups were dragged; `projectGroups` order is then the sidebar's. */
  projectGroupsOrdered?: true;
  sidebarView?: import("../../shared/types").SidebarView;
  /** Days without activity before a thread settles; null never, unset the default. */
  autoSettleDays?: number | null;
  /** Days after settling before a thread's worktree is removed; null never, unset the default. */
  worktreeCleanupDays?: number | null;
  chats?: import("../../shared/projects").ChatSummary[];
  aiSettings?: StoredAISettings;
  /** The agent last picked for a new thread, on the desktop or the phone. */
  newThreadAgent?: import("../../shared/agents").AgentProvider;
  /** Each agent's model a new thread starts on; see shared/new-thread-models. */
  newThreadModels?: import("../../shared/new-thread-models").NewThreadModels;
  devops?: import("../../shared/devops").DevOpsSettings;
  /** Encrypted with the OS credential store, like `encryptedToken`. */
  devopsPat?: string;
  devopsOpenRouterKey?: string;
  /** Built-in plugins turned on in Settings → Plugins. */
  plugins?: Partial<Record<import("../../shared/plugins").PluginId, boolean>>;
  /** Each plugin's secrets, encrypted with the OS credential store. */
  pluginSecrets?: Partial<
    Record<import("../../shared/plugins").PluginId, Record<string, string>>
  >;
  clockify?: {
    settings?: import("../../shared/clockify").ClockifySettings;
    day?: import("../../shared/clockify").ClockifyDay;
    review?: import("../../shared/clockify").ClockifyReview;
  };
  phoneRemote?: RemoteSettings;
  /** Computers this one hands threads to; see handoff/computers. */
  computers?: SavedComputer[];
  /** Engine, voices and speed for reading answers aloud. */
  readAloud?: import("../../shared/read-aloud").ReadAloudSettings;
  /** The Git executable chosen in Settings; unset, Relay finds its own. */
  gitPath?: string;
  /** Agent CLIs linked in Settings; a missing one is found by searching. */
  agentPaths?: Partial<
    Record<import("../../shared/agents").AgentProvider, string>
  >;
  /** Extra Claude Code and Codex sign-ins; see agents/accounts. */
  agentAccounts?: import("../../shared/agent-accounts").StoredAccounts;
  /** Source control hosts turned off, and the `gh` linked in Settings. */
  sourceControl?: import("../../shared/source-control").SourceControlSettings;
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
      // Gone from disk with the next write.
      for (const key of roomKeys) delete parsed[key];
      // Gitea "off" used to hide only its CI; now it signs out. Saves from
      // before `on` existed keep their Gitea account connected.
      const sc = parsed.sourceControl;
      if (sc && !sc.on) {
        sc.off = sc.off?.filter((kind: string) => kind !== "gitea");
        sc.on = [];
      }
      this.state = parsed;
      this.savedAtLoad = (await stat(join(this.dir, "state.json"))).mtimeMs;
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
  /** When state.json was last written before this launch; 0 for a first run. */
  savedAtLoad = 0;
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
