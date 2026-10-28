// What the bridge's calls carry: threads, projects and the overview as a
// phone shows them, diffs, dictation, read aloud and uploads, and the projects
// and folders paired computers trade.

import type { AgentProvider } from "./agents";
import type { DictationModelState } from "./dictation";
import type { SharedDraft } from "./drafts";
import type { ThreadGoal } from "./goal";
import type { HandoffSettings, HandoffThread } from "./handoff";
import type {
  ChatMessage,
  ChatPending,
  ChatScope,
  FolderEntry,
  LimitResume,
  ProjectChatPatch,
  ProjectChatSend,
  StartedBy,
} from "./projects";
import type { ThreadCost } from "./thread-cost";
import type { ChangeArea } from "./working-tree";

/** A thread as the phone's lists show it. */
export interface RemoteChatSummary {
  id: string;
  projectId: string;
  title: string;
  scope: ChatScope["kind"];
  updated: number;
  created: number;
  provider?: AgentProvider;
  running?: boolean;
  runningSince?: number;
  /** Needs the user; the agent may still be working on an async question. */
  waiting?: boolean;
  asking?: true;
  blocked?: true;
  settledAt?: number;
  /** Settled while it runs; older desktops leave it out, so it shows active until done. */
  settleWhenDone?: number;
  /** A computed shelf position rather than a saved settle mark. */
  autoSettled?: true;
  /** Marked unread by hand, until someone opens it; older desktops leave it out. */
  markedUnread?: true;
  snoozedAt?: number;
  snoozedUntil?: number;
  /** Read up to this `updated`, on the desktop or any phone. */
  seenAt?: number;
  branch?: string;
  worktree?: boolean;
  pending?: ChatPending[];
  /** When its next scheduled message goes out. */
  nextSend?: number;
  /** Changes with its queue and Send later list; older desktops leave it out. */
  queueMark?: string;
  empty?: boolean;
  /** Its native `/goal`; older desktops leave it out. */
  goal?: ThreadGoal;
  /** The thread whose agent started it; missing before `awayBridge`. */
  startedBy?: StartedBy;
  /** A deep review's reviewer: it opens from its review and no list shows it; older desktops leave it out. */
  reviewer?: true;
  /** The answer a usage limit stopped, resumed once the limit lifts; missing before `awayBridge`. */
  limitResume?: LimitResume;
  /** Changes with the thread's notes, so a phone knows to fetch them again; missing before `notesBridge`. */
  notesMark?: string;
}

export interface RemoteProject {
  id: string;
  name: string;
  /** Its virtual sidebar folder, e.g. `Work/Frontend`. */
  folder?: string;
  scratch?: boolean;
  plain?: boolean;
  /** Where its new threads start, when not the checkout. */
  workspace?: import("./projects").ChatWorkspace;
  /** Its folder is on another computer this one is paired with; from `remoteProjectsBridge`. */
  computer?: RemoteProjectComputer;
}

/** The computer a project lives on, as the desktop's project picker names it. */
export interface RemoteProjectComputer {
  /** Its name now, a tailnet name shortened to its first part. */
  name: string;
  /** That computer isn't paired anymore, so the project can't be reached. */
  gone?: true;
}

/**
 * A project's own icon (electron/projects/project-icon), by the hash of its data URL.
 * The data only comes along when the phone's copy is missing or stale; a
 * null hash means the project has none and keeps the folder.
 */
export type RemoteProjectIcon =
  { hash: string; dataUrl: string } | { hash: null };

/** A thread's image, as the phone asks for it with `image`. */
export type RemoteImageSource =
  | { kind: "attached"; chatId: string; imageId: string }
  | { kind: "read"; chatId: string; messageId: string; path: string }
  /** The preview's last frame turn `messageId` kept; from `previewBridge`. */
  | { kind: "preview"; chatId: string; messageId: string };

/** One colour mode of the desktop's theme, as its CSS tokens resolve it (src/lib/themes' tokens). */
export interface PhonePalette {
  kind: "light" | "dark";
  sidebar: string;
  surface: string;
  toolbar: string;
  inbox: string;
  text: string;
  muted: string;
  border: string;
  hover: string;
  selected: string;
  accent: string;
  accentSoft: string;
  onAccent: string;
  /** The Send button's own colour; desktops before it was sent leave it out. */
  send?: string;
  onSend?: string;
  diffAddition: string;
  diffDeletion: string;
}

/** The desktop's appearance, so a phone can wear the same theme. */
export interface PhoneAppearance {
  mode: "system" | "light" | "dark";
  light: PhonePalette;
  dark: PhonePalette;
}

export interface RemoteOverview {
  name: string;
  /** Missing before version 2. */
  bridge?: number;
  /** The desktop's Relay version; missing before version 11. */
  version?: string;
  /** Unknown until the desktop's window has applied its theme once. */
  appearance?: PhoneAppearance;
  /** The desktop's speech model, which phones dictate with; missing before version 8. */
  dictation?: DictationModelState["status"];
  /** Whether the desktop has a voice ready to read answers to phones; missing before version 12. */
  readAloud?: boolean;
  /** Someone is at the computer working in Relay, so phones keep news to themselves; missing where nobody can be. */
  present?: boolean;
  /** Every unsent draft, the desktop's and the phones'; missing before `draftsBridge`. */
  drafts?: SharedDraft[];
  projects: RemoteProject[];
  /** Unarchived threads with messages, newest first. */
  chats: RemoteChatSummary[];
}

/** What the thread's next message goes out with, as the desktop's composer last sent it. */
export type RemoteSettings = Pick<
  ProjectChatSend,
  "provider" | "choice" | "runtimeMode" | "interactionMode" | "contextWindow"
>;

/**
 * A message waiting its turn. Everything past `images` is optional: older
 * desktops leave it out, and a phone that doesn't know it ignores it.
 */
export interface RemoteQueued {
  id: string;
  body: string;
  /** How many screenshots it holds; `projectChatQueuedImages` hands them over. */
  images?: number;
  /** Why a steer was refused; it holds the queue until dealt with. */
  error?: string;
  /** When it was sent; older desktops leave it out. */
  created?: number;
  /**
   * A steer held a moment before its agent gets it, to be taken back with ×:
   * shown as the message it becomes, not in the queue. Older desktops leave it out.
   */
  held?: true;
  /** The side conversation it was sent in, by its root; left out for the main one. */
  parentId?: string;
  /** Who answers: an agent, or "message" for a note. */
  to?: NonNullable<ProjectChatSend["to"]>;
  /** What it goes out with, to put back in the composer when it's taken back. */
  settings?: RemoteSettings;
}

/** A thread, with messages the phone already holds at the same version sent as ids. */
export interface RemoteChat extends Pick<
  ProjectChatPatch,
  | "id"
  | "projectId"
  | "title"
  | "messages"
  | "requests"
  | "queuePaused"
  | "scope"
  | "stopped"
  | "pending"
  | "worktree"
  | "workspaceMoves"
> {
  running: boolean;
  /** The folder the thread works in; tool labels drop it, as on the desktop. Older desktops leave it out. */
  root?: string;
  /** Older messages left on the desktop; a phone gets the latest `remoteHistory`. */
  earlier: number;
  /** What all its answers cost, the earlier ones too, where their agent priced them. Older desktops leave it out. */
  cost?: ThreadCost;
  queue: RemoteQueued[];
  /** Sent with Send later, by when they go out. */
  scheduled: (RemoteQueued & { at: number })[];
  settings?: RemoteSettings;
  /** The conversation the last message went to: the main one, or a reply's root. */
  lastParentId?: string | null;
  /** Receipt for the requested send, including one still being processed; older desktops omit it. */
  hasSend?: boolean;
  /** The requested send is still in dispatch, so its eventual failure must stay in the outbox. */
  sendPending?: boolean;
}

/** Which turns of a thread come with their steps: every one, or only the latest (`stepsOnOpenBridge`). */
export type ChatSteps = "all" | "latest";

/** A finished turn's steps, which the copy of it a phone first got left out. */
export type MessageSteps = Pick<
  ChatMessage,
  "trace" | "activity" | "traceDropped"
>;

export const remoteHistory = 100;
/** The most a phone may ask for at once, a page of `remoteHistory` at a time. */
export const maxRemoteHistory = 1000;

export interface RemoteDiffLine {
  kind: "add" | "del" | "same";
  text: string;
  old?: number;
  new?: number;
}

export interface RemoteDiff {
  path: string;
  binary: boolean;
  hunks: { header: string; lines: RemoteDiffLine[] }[];
  /** Cut to keep the phone responsive; the desktop shows all of it. */
  truncated: boolean;
}

/** Which diff a phone asks for; the desktop turns it into lines. */
export type RemoteDiffSource =
  | { kind: "turn"; chatId: string; messageId: string; path: string }
  | { kind: "working"; where: string; path: string; area: ChangeArea }
  | { kind: "commit"; where: string; sha: string; path: string }
  | { kind: "worktree"; chatId: string; path: string };

/**
 * Dictation on a phone: the phone's microphone, the desktop's speech engine.
 * One session per phone; a new start ends the last one.
 */
export type PhoneDictation =
  | { type: "start"; id: number }
  /** About 80 ms of 16 kHz mono 16-bit little-endian PCM, as base64. */
  | { type: "audio"; id: number; pcm: string }
  /** Settles the last words; the answer's `settled` is the whole text. */
  | { type: "stop"; id: number }
  | { type: "cancel"; id: number };
/** Everything heard so far: `settled` won't change, `tentative` may. */
export interface PhoneDictationHeard {
  settled: string;
  tentative: string;
  /** The engine is still loading the model; the audio waits for it. */
  loading: boolean;
}

/** The most base64 one audio call may carry: a second of speech. */
export const maxDictationChunk = 44_000;

/**
 * Read aloud on a phone: the desktop's voice, the phone's speaker. The phone
 * pulls the audio as it plays, so the desktop never has to find one phone to
 * push to. One reading per phone; a new start ends the last.
 */
export type PhoneReadAloud =
  | { type: "start"; id: number; markdown: string }
  | { type: "pull"; id: number }
  | { type: "stop"; id: number };
export interface PhoneReadAloudAudio {
  /** Mono 16-bit little-endian PCM as base64, at most `maxReadAloudPull` seconds; empty when none is ready. */
  pcm: string;
  sampleRate: number;
  /** The desktop is still loading the voice. */
  loading: boolean;
  /** Nothing more is coming after this audio. */
  done: boolean;
}

export const maxReadAloudPull = 3;
/** The longest answer a phone may ask to hear, in characters. */
export const maxReadAloudText = 1_000_000;

export type HandoffPart = "thread" | "bundle";

/** A folder here as `computerFolders` lists it; `project` when it's one already. */
export interface ComputerFolder extends FolderEntry {
  project?: { id: string; name: string };
}

export interface ComputerFolders {
  /** This computer's home folder, which `~` stands for. */
  home: string;
  /** `dir` as it resolved here. */
  dir: string;
  folders: ComputerFolder[];
}

/** What starts a thread in a project another computer shows as its own. */
export type HomeThread = Pick<
  HandoffThread,
  "from" | "title" | "scope" | "settings" | "messages"
>;

/** A project on a computer taking handoffs, by its Git remotes' `owner/name`. */
export interface ComputerProject {
  id: string;
  name: string;
  repositories: string[];
  /** Its folder, from the home folder as `~`; with a project just made there. */
  folder?: string;
  /** Its folder has no Git repository; from `remoteProjectsBridge`. */
  plain?: true;
}

/** A clone `cloneProject` started: still going, or the project it made. */
export type CloneProgress =
  | { done: false; step: string; progress: number | null }
  | { done: true; project: ComputerProject };
/** What a computer's setup agent is to clone, and why Relay's own clone didn't. */
export interface SetupRequest {
  url: string;
  repositories: string[];
  /** What git said when the clone failed. */
  error: string;
  /** The agent and how it runs, as the thread it's for runs. */
  settings: HandoffSettings;
}

/** How far a phone's file got; `path`, where the message names it, once all of it is here. */
export interface UploadedFile {
  received: number;
  path?: string;
}

/** What a phone uploads per `uploadFile` call, before base64. */
export const fileUploadChunk = 1024 * 1024;
/** The largest file a phone may attach. */
export const maxUploadBytes = 200 * 1024 * 1024;
