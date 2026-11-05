import { readFile, mkdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { Account, Progress, WorkspaceState } from "../../shared/types";
import {
  aiSettingsSchema,
  defaultAISettings,
  type StoredAISettings,
} from "../../shared/settings";
import type { RemoteSettings, SavedComputer } from "./store-types";
import { writeFileAtomic } from "../util/atomic-write";

interface State {
  projects?: import("../../shared/projects").Project[];
  /** Where the last clone or new project went; the add-project palette starts there. */
  projectsFolder?: string;
  /** Sidebar group paths, kept even while no project is in them. */
  projectGroups?: string[];
  /** Prettify automatic project names; unset keeps the original default (on). */
  smartProjectNames?: boolean;
  /** Every thread's agent starts, messages, stops and settles threads in any project without asking; unset is off. */
  drivesThreads?: boolean;
  /** Look for newer agent releases every few hours and offer them under the sidebar; unset is on. */
  agentUpdateChecks?: boolean;
  /** When big conversations compact unasked; unset is both off. */
  autoCompact?: import("../../shared/context-usage").AutoCompact;
  /** Sounds for threads that finish, need you or fail; unset plays nothing. */
  sounds?: import("../../shared/sounds").SoundSettings;
  /** Sound files added in Settings → Sounds, kept in `sounds/` under app data. */
  customSounds?: import("../sounds").StoredCustomSound[];
  /** Draft the message you'd likely send next once a Claude or Codex turn ends; unset is off. */
  composerPredictions?: boolean;
  /** When agents show pages in answers; unset is auto. */
  renderMode?: import("../../shared/html-render").RenderMode;
  /** Topics the watcher was told are already known, newest last. */
  watchKnown?: string[];
  /** Legacy saves: automatic names were already title-cased by the old migration. */
  projectTitlesTidied?: true;
  /** Set once groups were dragged; `projectGroups` order is then the sidebar's. */
  projectGroupsOrdered?: true;
  sidebarView?: import("../../shared/types").SidebarView;
  /** Threads open in windows of their own, and where; they reopen after a restart. */
  threadWindows?: import("../../shared/thread-windows").SavedThreadWindow[];
  /** Editors open in windows of their own, and where; they reopen after a restart. */
  editorWindows?: import("../../shared/editor-windows").SavedEditorWindow[];
  /** The main window's size and state when it last changed. */
  mainWindow?: import("../../shared/thread-windows").SavedMainWindow;
  /** Frosted glass, on unless the page last said off; windows then start clear. */
  glass?: boolean;
  chats?: import("../../shared/projects").ChatSummary[];
  /** Prompts Relay sends on its own; see shared/schedules. */
  schedules?: import("../../shared/schedules").Schedule[];
  /** The deep review sheet's setups, newest first, for the deep_review tool. */
  reviewSetups?: import("../../shared/deep-review").SavedReviewSetup[];
  /** This computer's last page and known server command for each thread. */
  previews?: Record<string, import("../preview/saved-previews").SavedPreview>;
  aiSettings?: StoredAISettings;
  /** The agent last picked for a new thread, on the desktop or the phone. */
  newThreadAgent?: import("../../shared/agents").AgentProvider;
  /** Each agent's model a new thread starts on; see shared/new-thread-models. */
  newThreadModels?: import("../../shared/new-thread-models").NewThreadModels;
  /** The access a new thread starts on: the one last picked for a new thread or sent with in any. */
  newThreadRuntimeMode?: import("../../shared/agent-modes").RuntimeMode;
  devops?: import("../../shared/devops").DevOpsSettings;
  /** Encrypted with the OS credential store, like `encryptedToken`. */
  devopsPat?: string;
  devopsOpenRouterKey?: string;
  /** Built-in plugins turned on in Settings → Integrations. */
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
  /** The speech engine dictation uses; unset, Parakeet. */
  dictationEngine?: import("../../shared/dictation").DictationEngine;
  /** The UTC day this install last said it was in use; see ./daily-ping. */
  pingedOn?: string;
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

const STATE_FILE = "state.json";
export const BACKUP_FILE = "state.json.bak";
/** How long `updateSoon` gathers changes before it writes them. */
const WRITE_SOON_MS = 1000;

/** The saved state, or undefined when the text isn't a saved state at all (empty, cut off). */
function parseState(text: string): State | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  const version = (parsed as { version?: unknown } | null)?.version;
  if (typeof version === "number" && version > 1)
    throw new Error(
      "Relay's saved data was written by a newer version of Relay. Update Relay to open it.",
    );
  return version === 1 ? (parsed as State) : undefined;
}

const damagedError = (path: string) =>
  new Error(
    `Relay's saved data (${path}) is damaged, and there is no readable earlier copy to fall back on. It was left as it is; moving it elsewhere starts Relay without your projects and settings.`,
  );

export class Store {
  private state: State = { version: 1, folders: {}, progress: {} };
  private queue: Promise<void> = Promise.resolve();
  private writeError: unknown;
  /** The launch's copy of state.json, written while Relay starts rather than before. */
  private backup: Promise<void> = Promise.resolve();

  /** Changes `updateSoon` made that no write has carried to the file yet. */
  private unwritten = false;
  private writeTimer?: ReturnType<typeof setTimeout>;

  async flush() {
    // An updateSoon queued behind a write under way changes nothing until
    // its turn comes, so what it leaves unwritten is only known after.
    await Promise.all([this.queue, this.backup]);
    if (this.unwritten) await this.writeUnwritten().catch(() => {});
    if (this.writeError) throw this.writeError;
  }

  /** App data; other services keep their files beside state.json. */
  constructor(readonly dir: string) {}

  async load() {
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    const path = join(this.dir, STATE_FILE);
    const text = await readFile(path, "utf8").catch((e) => {
      const code = (e as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return undefined;
      throw new Error(
        `Relay's saved data (${path}) could not be read (${code}).`,
      );
    });
    if (text === undefined) return; // first run

    const saved = parseState(text);
    if (saved) {
      this.state = saved;
      this.savedAtLoad = (await stat(path)).mtimeMs;
      this.backup = this.keepBackup(text);
      return;
    }

    const backup = await readFile(join(this.dir, BACKUP_FILE), "utf8")
      .then(parseState)
      .catch(() => undefined);
    if (!backup) throw damagedError(path);
    console.warn(
      `[store] ${STATE_FILE} could not be read; starting from ${BACKUP_FILE}, the copy kept at the last good launch`,
    );
    this.state = backup;
    // Threads that changed after the copy was made get their summaries back from their own files.
    this.savedAtLoad = 0;
  }

  /** The copy load falls back to when a power cut leaves state.json empty; made once a launch. */
  private async keepBackup(text: string) {
    await writeFileAtomic(join(this.dir, BACKUP_FILE), text, {
      sync: true,
    }).catch((e) =>
      console.warn(`[store] Could not keep a copy of ${STATE_FILE}:`, e),
    );
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
      await this.write(next);
      this.state = next;
    });
    // A change its caller refused never reached the file, so nothing waits to be saved.
    this.queue = task.catch(() => {});
    await task;
  }

  /**
   * Changes the state now and writes the file a moment later, with whatever
   * else changed meanwhile: a turn starting changes a thread's summary a few
   * times at once. Only for what a crash may lose, like thread summaries,
   * which launch reads back from the threads' own files.
   */
  async updateSoon(fn: (s: State) => void) {
    const task = this.queue.then(() => {
      const next = structuredClone(this.state);
      fn(next);
      this.state = next;
      this.unwritten = true;
      this.writeTimer ??= setTimeout(
        () => void this.writeUnwritten().catch(() => {}),
        WRITE_SOON_MS,
      );
      this.writeTimer.unref?.();
    });
    this.queue = task.catch(() => {});
    await task;
  }

  private writeUnwritten() {
    clearTimeout(this.writeTimer);
    this.writeTimer = undefined;
    const task = this.queue.then(async () => {
      if (this.unwritten) await this.write(this.state);
    });
    this.queue = task.catch(() => {});
    return task;
  }

  /** Writes `state` whole; it holds every change `updateSoon` made before it. */
  private async write(state: State) {
    try {
      await writeFileAtomic(join(this.dir, STATE_FILE), JSON.stringify(state));
    } catch (error) {
      this.writeError = error;
      throw error;
    }
    this.writeError = undefined;
    this.unwritten = false;
    clearTimeout(this.writeTimer);
    this.writeTimer = undefined;
  }
}
