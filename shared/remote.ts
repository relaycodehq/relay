/**
 * Relay's phone remote: a phone pairs with the desktop over Tailscale or, when
 * the desktop allows it, the local network, and drives its threads. The desktop hosts the
 * bridge; the phone only ever talks to it. Pure types and helpers, so the
 * phone app can import this file without the desktop's dependencies.
 */

import type { DraftChange, DraftWrite, SharedDraft } from "./drafts";
import type {
  ComputerInfo,
  HandBack,
  HandoffChat,
  HandoffLive,
  HandoffMethod,
  HandoffRemoteStatus,
  RemoteProjectMethod,
} from "./handoff";
import type { PhoneAppReport } from "./phone-app";
import type { ChatMessage, KnownMessages, ProjectChatSend } from "./projects";
import type { ChatsPatch, MessagePatch } from "./remote-delta";
import type {
  ComputerCallMethod,
  PhoneDesktopMethod,
  TerminalOp,
} from "./remote-methods";
import type {
  CloneProgress,
  ComputerFolders,
  ComputerProject,
  HandoffPart,
  HomeThread,
  PhoneAppearance,
  PhoneDictation,
  PhoneDictationHeard,
  PhoneReadAloud,
  PhoneReadAloudAudio,
  RemoteChat,
  RemoteChatSummary,
  RemoteDiff,
  RemoteDiffSource,
  RemoteImageSource,
  RemoteOverview,
  RemoteProjectIcon,
  SetupRequest,
  UploadedFile,
} from "./remote-models";
import type { DeviceKind } from "./remote-pairing";
import type { RemoteSite } from "./remote-tunnel";
import type { SubagentDetail, SubagentRun } from "./subagents";
import type { TerminalEvent, TerminalOpened } from "./terminals";
import type { NewsCatchUp, NewsCursor, NewsItem } from "./thread-news";
import type { UpdateState } from "./updates";

export * from "./remote-bridges";
export * from "./remote-methods";
export * from "./remote-models";
export * from "./remote-pairing";

/** Everything a paired phone may ask of the desktop. Nothing else is reachable. */
export interface RemoteApi {
  overview(): Promise<RemoteOverview>;
  /** The thread with its latest `history` messages, `remoteHistory` by default. */
  chat(
    id: string,
    known?: KnownMessages,
    history?: number,
    sendId?: string,
  ): Promise<RemoteChat>;
  /** Null when unchanged; lists omit briefs, which belong in the run. */
  subagents(
    chatId: string,
    known?: string,
  ): Promise<{ signature: string; runs: SubagentRun[] } | null>;
  /** Null when unchanged; a missing session returns a signed `run: null`. */
  subagentRun(
    chatId: string,
    agentId: string,
    known?: string,
  ): Promise<{ signature: string; run: SubagentDetail | null } | null>;
  diff(source: RemoteDiffSource): Promise<RemoteDiff>;
  desktop(method: PhoneDesktopMethod, args: unknown[]): Promise<unknown>;
  /** Icons that differ from the phone's `known` hashes, by project id. */
  projectIcons(
    known: Record<string, string | null>,
  ): Promise<Record<string, RemoteProjectIcon>>;
  /** What the phone's app runs, for the desktop's Settings. */
  reportApp(report: PhoneAppReport): Promise<void>;
  dictate(request: PhoneDictation): Promise<PhoneDictationHeard>;
  /** Missing before `readAloudBridge`. */
  readAloud(request: PhoneReadAloud): Promise<PhoneReadAloudAudio>;
  /** A tool call's whole output, which the thread sent cut; missing before `activityDetailBridge`. */
  activityDetail(
    chatId: string,
    messageId: string,
    activityId: string,
  ): Promise<string | null>;
  /** The image as a data URL at most `max` pixels on its longer side; missing before `imageBridge`. */
  image(source: RemoteImageSource, max: number): Promise<string>;
  /** The news after `cursor`, or where it is now without one; missing before `newsBridge`. */
  news(cursor?: NewsCursor): Promise<NewsCatchUp>;
  /** One page of a thread's render, as the agent wrote it; missing before `renderBridge`. */
  renderPage(chatId: string, renderId: string, page: number): Promise<string>;
  /** Projects' tasks listening on a port, one per port; from `tunnelBridge`. */
  sites(): Promise<RemoteSite[]>;
  /** A port typed into the phone's address bar, which the tunnel may then reach besides Sites'; from `tunnelBridge`. */
  tunnelAllow(port: number): Promise<void>;
  /** The phone's edit of a draft; the draft as it stands after, null once gone. From `draftsBridge`. */
  saveDraft(write: DraftWrite): Promise<SharedDraft | null>;
  /** Swaps in the version a clash kept, or with `drop` lets it go. From `draftsBridge`. */
  draftOther(key: string, drop: boolean): Promise<SharedDraft | null>;
  /**
   * Sends a draft the desktop holds part of (a screenshot, a code reference)
   * from the desktop's composer, with the phone's message; `chatId` is null
   * for a new thread. The thread it went to. From `draftsBridge`.
   */
  sendDraft(
    key: string,
    chatId: string | null,
    send: ProjectChatSend,
  ): Promise<{ chatId: string }>;
  /**
   * Appends `data` (base64) at `offset` of the phone's file `id`, called
   * `name`, `size` bytes in all. A chunk the computer already has is skipped
   * and one past what it has changes nothing, so the phone carries on from
   * `received` after any failure. From `filesBridge`.
   */
  uploadFile(
    id: string,
    name: string,
    size: number,
    offset: number,
    data: string,
  ): Promise<UploadedFile>;
  /** Computers only from here, handing threads over; see shared/handoff. */
  computerProjects(): Promise<ComputerProject[]>;
  /**
   * Clones `url` into the folder clones go to here and adds it as a project,
   * or joins the clone of it under way; answers within seconds with how far
   * it is, so the caller asks again until it's done. From `cloneBridge`.
   * `into` chooses the parent folder from `remoteAddingBridge`.
   */
  cloneProject(url: string, into?: string): Promise<CloneProgress>;
  /**
   * Starts an agent here, in a Scratchpad thread of its own, that gets the
   * repository cloned and added where the clone failed; the same id again
   * changes nothing. The thread follows like a live handoff's, by this id
   * (`handoffChat`, `handoffCall`, `handedBack`, `handoffAbandoned`). From
   * `setupBridge`.
   */
  setupProject(id: string, request: SetupRequest): Promise<void>;
  /**
   * The project, once a project here has one of `repositories`. Given a
   * `folder` the user says holds a clone, adds it first when it does.
   */
  setupProgress(
    id: string,
    repositories: string[],
    folder?: string,
  ): Promise<{ done: false } | { done: true; project: ComputerProject }>;
  /** A saved paste, uploaded in chunks; returns its path on this computer. */
  uploadPaste(
    id: string,
    n: number,
    offset: number,
    data: string,
  ): Promise<string>;
  /** A chunk of a Relay-owned paste; null for paths outside its paste folder. */
  downloadPaste(path: string, offset: number): Promise<string | null>;
  /** Appends base64 `data` at `offset` of the handoff's thread or bundle; a repeat is ignored. */
  handoffUpload(
    id: string,
    part: HandoffPart,
    offset: number,
    data: string,
  ): Promise<void>;
  /** Takes the uploaded thread over; the same id again answers the same. */
  receiveHandoff(id: string): Promise<{ chatId: string; project: string }>;
  /** Handed-over threads by handoff id; null for one this computer doesn't have. */
  handoffStatus(
    ids: string[],
  ): Promise<Record<string, HandoffRemoteStatus | null>>;
  /** Stops the thread here and readies it to go back; `handoffDownload` fetches it. */
  handBack(id: string): Promise<HandBack>;
  handoffDownload(
    id: string,
    part: HandoffPart,
    offset: number,
  ): Promise<string>;
  /** The thread arrived back; the copy here stays still. */
  handedBack(id: string): Promise<void>;
  /** The sender took the thread back without this computer; its copy here is no longer owed. Missing before this was added; callers ignore the refusal. */
  handoffAbandoned(id: string): Promise<void>;
  /** This Relay's version, its bridge's and its update; missing before bridge 10. */
  computerInfo(): Promise<ComputerInfo>;
  /** Checks for Relay's latest release, downloads it and restarts into it. */
  updateNow(): Promise<UpdateState>;
  /** A live handoff's thread as written here; missing before `liveHandoffBridge`. */
  handoffChat(id: string, known?: KnownMessages): Promise<HandoffChat>;
  /**
   * Runs one of `handoffMethods` on the thread, its id, or for a folder
   * call its workspace id, in place of the first argument.
   */
  handoffCall(
    id: string,
    method: HandoffMethod,
    args: unknown[],
  ): Promise<unknown>;
  /** The folders in `dir` here (`~` is the home folder), for adding one as a project. From `remoteProjectsBridge`. */
  computerFolders(dir: string): Promise<ComputerFolders>;
  /** Adds the folder here as a project, or finds the project it already is. */
  computerAddProject(path: string): Promise<ComputerProject>;
  /**
   * Starts a thread in the project's own folder here: its first message is
   * its first turn, and the thread follows like a live handoff's, by this id.
   * The same id again changes nothing.
   */
  startInProject(
    id: string,
    projectId: string,
    thread: HomeThread,
  ): Promise<{ chatId: string }>;
  /** Runs one of `computerCallMethods` here, as this computer answers it for itself. */
  computerCall(method: ComputerCallMethod, args: unknown[]): Promise<unknown>;
  /** Runs one of `remoteProjectMethods` on the project here, its id in place of the first argument. */
  projectCall(
    projectId: string,
    method: RemoteProjectMethod,
    args: unknown[],
  ): Promise<unknown>;
  /**
   * Opens the caller's shell `key` in the project's folder here, starting it
   * if needed; its output comes back as `terminal` events.
   */
  projectTerminal(
    projectId: string,
    key: string,
    size: { cols: number; rows: number },
    fresh?: boolean,
  ): Promise<TerminalOpened>;
  /** One of `terminalOps` on a shell `projectTerminal` opened. */
  terminalCall(op: TerminalOp, key: string, args: unknown[]): Promise<unknown>;
}

export type RemoteMethod = keyof RemoteApi;

export type RemoteEvent =
  | { kind: "message"; chatId: string; message: ChatMessage; title?: string }
  /** Thread states moved: something started, finished or asked a question. */
  | { kind: "chats"; chats: RemoteChatSummary[] }
  /** A thread finished, failed or needs you, as the computer decided; from `newsBridge`. */
  | { kind: "news"; item: NewsItem }
  | { kind: "appearance"; appearance: PhoneAppearance }
  /**
   * `present` changed: someone came back (just before the thread list it
   * applies to) or left (just after it). Only to phones from `draftsBridge`.
   */
  | { kind: "presence"; present: boolean }
  /** A draft changed; only to phones from `draftsBridge`. */
  | { kind: "draft"; change: DraftChange }
  /** To the computer a live handoff came from: what runs and waits in its thread now. */
  | { kind: "handoff"; id: string; live: HandoffLive }
  /** To the computer a shell here belongs to (`projectTerminal`): its output, or its exit. */
  | { kind: "terminal"; event: TerminalEvent };

/** What goes over the wire: events, or from `compactBridge` patches the client turns back into them. */
export type WireEvent =
  | RemoteEvent
  | {
      kind: "messagePatch";
      chatId: string;
      patch: MessagePatch;
      title?: string;
    }
  | { kind: "chatsPatch"; patch: ChatsPatch };

/**
 * Frames inside the encrypted channel. `bridge` is the client's own
 * `remoteBridgeVersion`; clients before `compactBridge` send none.
 */
export type ClientFrame =
  | import("./remote-batches").MessageBatchFrame
  | { t: "batchCancel"; batch: number }
  | {
      t: "pair";
      code: string;
      device: string;
      kind?: DeviceKind;
      bridge?: number;
    }
  | { t: "auth"; deviceId: string; token: string; bridge?: number }
  | { t: "call"; id: number; method: RemoteMethod; args: unknown[] }
  /** The streaming frame numbered `s` arrived; from `compactBridge`. */
  | { t: "got"; s: number }
  /** The phone went to the background or came back; from `backgroundBridge`. */
  | { t: "background"; on: boolean };
export type ServerFrame =
  /** `bridge` is the desktop's `remoteBridgeVersion`; desktops before `to` send none. */
  | {
      t: "paired";
      deviceId: string;
      token: string;
      name: string;
      bridge?: number;
      /** Where the desktop listens now; desktops before local network access send none. */
      hosts?: string[];
    }
  | { t: "ready"; name: string; bridge?: number; hosts?: string[] }
  | { t: "denied"; reason: string }
  | { t: "result"; id: number; ok: true; value: unknown }
  | { t: "result"; id: number; ok: false; error: string }
  /** `s` numbers a streaming frame the client acknowledges with `got`. */
  | { t: "event"; event: WireEvent; s?: number }
  /** Keepalive and current routes: a phone that stops hearing these treats the link as dead. */
  | { t: "tick"; hosts?: string[] };

/** The unencrypted opening, one each way; see shared/remote-crypto. */
export interface HelloFrame {
  t: "hello";
  v: number;
  /** Ephemeral X25519 public key, base64url. */
  e: string;
}
