import type { ThreadGoal } from "./goal";
import type { DictationModelState } from "./dictation";
import type { ComputerInfo, HandBack, HandoffRemoteStatus } from "./handoff";
import type { SubagentDetail, SubagentRun } from "./subagents";
import type { UpdateState } from "./updates";
import type { PhoneAppReport } from "./phone-app";
/**
 * Relay's phone remote: a phone pairs with the desktop over the local network
 * (or a VPN such as Tailscale) and drives its threads. The desktop hosts the
 * bridge; the phone only ever talks to it. Pure types and helpers, so the
 * phone app can import this file without the desktop's dependencies.
 */
import type { AgentProvider } from "./agents";
import type {
  ChatMessage,
  ChatPending,
  ChatScope,
  KnownMessages,
  LimitResume,
  ProjectChatPatch,
  ProjectChatSend,
  StartedBy,
} from "./projects";
import type { Api, ApiMethod } from "./types";
import type { ChangeArea } from "./working-tree";
import type { ChatsPatch, MessagePatch } from "./remote-delta";

export const remoteProtocol = 1;
const remoteScheme = "relay-remote";
export const defaultRemotePort = 47821;
/** Where to get Tailscale: its download page for computers, Google Play for phones. */
export const tailscaleDownload = "https://tailscale.com/download";
export const tailscaleAndroid =
  "https://play.google.com/store/apps/details?id=com.tailscale.ipn";

/** What the desktop's QR code carries; the key pins the desktop the phone may talk to. */
export interface PairingLink {
  /** Addresses to try, best first: LAN, then VPN. */
  hosts: string[];
  port: number;
  /** The desktop's X25519 public key, base64url. */
  key: string;
  /** One-time secret, traded for a device token on first contact. */
  code: string;
  /** The computer's name, shown on the phone. */
  name: string;
}

export function pairingUrl(link: PairingLink): string {
  const q = new URLSearchParams({
    h: link.hosts.join(","),
    p: String(link.port),
    k: link.key,
    c: link.code,
    n: link.name,
  });
  return `${remoteScheme}://pair?${q}`;
}

/** Accepts the link itself or a URL wrapping it, e.g. Expo Go's `exp://…/--/pair?…`. */
export function parsePairingUrl(text: string): PairingLink | null {
  const query = text.trim().match(/[/:]pair\?(.+)$/)?.[1];
  if (!query) return null;
  const q = new URLSearchParams(query);
  const hosts = (q.get("h") ?? "").split(",").filter(validHost),
    port = Number(q.get("p")),
    key = q.get("k") ?? "",
    code = q.get("c") ?? "",
    name = (q.get("n") ?? "").slice(0, 80) || "Relay";
  if (
    !hosts.length ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535 ||
    !/^[A-Za-z0-9_-]{43}$/.test(key) ||
    !/^[A-Za-z0-9_-]{16,64}$/.test(code)
  )
    return null;
  return { hosts, port, key, code, name };
}

const validHost = (host: string) =>
  /^[A-Za-z0-9.-]{1,253}$/.test(host) || /^\[[0-9a-fA-F:]+\]$/.test(host);

/** What a paired phone keeps to reconnect: the pinned desktop and its own token. */
export interface RemoteCredentials {
  hosts: string[];
  port: number;
  key: string;
  name: string;
  deviceId: string;
  token: string;
}

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
  /** The agent asked something and is waiting for an answer. */
  waiting?: boolean;
  settledAt?: number;
  snoozedAt?: number;
  snoozedUntil?: number;
  /** Read up to this `updated`, on the desktop or any phone. */
  seenAt?: number;
  branch?: string;
  worktree?: boolean;
  pending?: ChatPending[];
  /** When its next scheduled message goes out. */
  nextSend?: number;
  empty?: boolean;
  /** Its native `/goal`; older desktops leave it out. */
  goal?: ThreadGoal;
  /** The thread whose agent started it; missing before `awayBridge`. */
  startedBy?: StartedBy;
  /** The answer a usage limit stopped, resumed once the limit lifts; missing before `awayBridge`. */
  limitResume?: LimitResume;
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
}

/**
 * A project's own icon (electron/projects/project-icon), by the hash of its data URL.
 * The data only comes along when the phone's copy is missing or stale; a
 * null hash means the project has none and keeps the folder.
 */
export type RemoteProjectIcon =
  { hash: string; dataUrl: string } | { hash: null };

/** Bumped when the bridge gains calls; a phone asks for an update of an older desktop. */
export const remoteBridgeVersion = 15;
/**
 * A desktop that reports its bridge in `paired`/`ready` takes a send's `to`;
 * older ones report none and refuse fields they don't know.
 */
export const recipientBridge = 11;
/** From here a desktop reads answers aloud to phones (`readAloud`). */
export const readAloudBridge = 12;
/**
 * From here a desktop sends phones a tool call's output cut to
 * `phoneDetailPreview` characters, and the whole of it on `activityDetail`.
 */
export const activityDetailBridge = 13;
export const phoneDetailPreview = 600;
/** From here a desktop sends a thread's images shrunk to the size a phone shows them (`image`). */
export const imageBridge = 14;

/**
 * From here phones may list a thread's subagents, read one's run (its tool
 * output cut as a thread's is) and stop one, with conditional reads.
 */
export const subagentsBridge = 15;

/** A thread's image, as the phone asks for it with `image`. */
export type RemoteImageSource =
  | { kind: "attached"; chatId: string; imageId: string }
  | { kind: "read"; chatId: string; messageId: string; path: string };
/**
 * From here a desktop tells phones which thread started which and when a
 * limited answer resumes, and takes `setLimitResume` and `closeWatchNote`.
 */
export const awayBridge = 13;
/**
 * From here both ends, once each has said it speaks this bridge, send frames
 * as deflated binary instead of base64 text, the desktop sends streaming
 * answers and thread lists as patches on the last ones (shared/remote-delta),
 * and the phone acknowledges streaming frames so the desktop never sends
 * them faster than the link carries them.
 */
export const compactBridge = 14;
/** Computers hand threads to each other from the same bridge on; read aloud didn't change handoffs. */
export const handoffBridge = 11;

/**
 * The phone app's code this desktop carries (scripts/export-phone-bundle.mjs),
 * so a paired phone updates from its own computer, over the encrypted link.
 */
export interface PhoneAppRelease {
  /** The Relay release it was built with. */
  version: string;
  /** Fingerprint of the app's native side; the code only runs on an APK built with the same. */
  runtime: string;
  /** The file React Native loads; the rest are its images, laid out beside it. */
  bundle: string;
  files: { path: string; size: number; sha256: string }[];
}
/** The most of a phone-app file one call returns. */
export const phoneAppChunk = 512 * 1024;

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
  /** Missing before version 7, and in builds made without the phone app. */
  phoneApp?: PhoneAppRelease;
  /** The desktop's speech model, which phones dictate with; missing before version 8. */
  dictation?: DictationModelState["status"];
  /** Whether the desktop has a voice ready to read answers to phones; missing before version 12. */
  readAloud?: boolean;
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
> {
  running: boolean;
  /** The folder the thread works in; tool labels drop it, as on the desktop. Older desktops leave it out. */
  root?: string;
  /** Older messages left on the desktop; a phone gets the latest `remoteHistory`. */
  earlier: number;
  queue: RemoteQueued[];
  /** Sent with Send later, by when they go out. */
  scheduled: (RemoteQueued & { at: number })[];
  settings?: RemoteSettings;
  /** The conversation the last message went to: the main one, or a reply's root. */
  lastParentId?: string | null;
}

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
 * Desktop calls a paired phone makes as they are, validated by the desktop's
 * own dispatch: threads, models, Git (stage, commit, push, pull, fetch,
 * branches), read-only files, history, background tasks and subagents; only what the
 * phone app uses. Terminals, file saves, settings (bar the agent new threads
 * start on), sharing and anything that opens a desktop dialog are not on the
 * list and stay out of reach.
 */
export const phoneDesktopMethods = [
  "createProjectChat",
  "createScratch",
  "sendProjectChat",
  "cancelProjectChat",
  "respondProjectChat",
  "answerProjectChatQuestion",
  "setProjectChatQuestionDismissed",
  "projectChatQueueAction",
  "resumeProjectChat",
  "compactProjectChat",
  "reloadProjectChatSession",
  "rerunWorktreeSetup",
  "resolveStoppedWork",
  "stopProjectChatPending",
  "projectChatAgents",
  "projectChatAgent",
  "stopProjectChatAgent",
  "triageProjectChat",
  "renameProjectChat",
  "markProjectChatSeen",
  "forkProjectChat",
  "rewindProjectTurn",
  "setLimitResume",
  "closeWatchNote",
  "projectChatImage",
  "projectChatReadImage",
  "projectChatQueuedImages",
  "agentModels",
  "agentDefaults",
  "aiSettings",
  "newThreadAgent",
  "saveNewThreadAgent",
  "newThreadModels",
  "saveNewThreadModel",
  "projectWorktree",
  "projectCommands",
  "providerUsage",
  "projectWorkingTree",
  "projectGitAction",
  "projectCiStatus",
  "projectMergePlan",
  "projectMergeBranch",
  "projectCommitMessage",
  "projectBranches",
  "projectChangeBranch",
  "projectHistory",
  "projectCommit",
  "projectFiles",
  "projectFile",
  "projectTasks",
  "stopProjectTask",
  "restartProjectTask",
] as const satisfies readonly ApiMethod[];
export type PhoneDesktopMethod = (typeof phoneDesktopMethods)[number];

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

/** Everything a paired phone may ask of the desktop. Nothing else is reachable. */
export interface RemoteApi {
  overview(): Promise<RemoteOverview>;
  /** The thread with its latest `history` messages, `remoteHistory` by default. */
  chat(
    id: string,
    known?: KnownMessages,
    history?: number,
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
  /** Up to `phoneAppChunk` bytes of a file in `phoneApp`, from `offset`, as base64. */
  phoneAppFile(path: string, offset: number): Promise<string>;
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
  /** Computers only from here, handing threads over; see shared/handoff. */
  computerProjects(): Promise<ComputerProject[]>;
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
}
export type HandoffPart = "thread" | "bundle";
/** A project on a computer taking handoffs, by its Git remotes' `owner/name`. */
export interface ComputerProject {
  id: string;
  name: string;
  repositories: string[];
}
export type RemoteMethod = keyof RemoteApi;
export const remoteMethods = [
  "overview",
  "chat",
  "diff",
  "desktop",
  "projectIcons",
  "subagents",
  "subagentRun",
  "phoneAppFile",
  "reportApp",
  "dictate",
  "readAloud",
  "activityDetail",
  "image",
  "computerProjects",
  "handoffUpload",
  "receiveHandoff",
  "handoffStatus",
  "handBack",
  "handoffDownload",
  "handedBack",
  "handoffAbandoned",
  "computerInfo",
  "updateNow",
] as const satisfies readonly RemoteMethod[];
/** What a paired computer may call; phones only `updateMethods`. */
export const computerMethods = [
  "computerProjects",
  "handoffUpload",
  "receiveHandoff",
  "handoffStatus",
  "handBack",
  "handoffDownload",
  "handedBack",
  "handoffAbandoned",
  "computerInfo",
  "updateNow",
] as const satisfies readonly RemoteMethod[];
export type ComputerMethod = (typeof computerMethods)[number];
/** The bridge from which phones may call `updateMethods` too. */
export const phoneUpdatesBridge = 11;
/** About this Relay itself, so a phone may ask too, from `phoneUpdatesBridge`. */
export const updateMethods = [
  "computerInfo",
  "updateNow",
] as const satisfies readonly ComputerMethod[];
/**
 * Calls that stop an agent, wait for its note or move a repository's worth
 * of Git; a dead link still fails them within a minute, as its ticks stop.
 */
export const slowRemoteMethods: readonly RemoteMethod[] = [
  "receiveHandoff",
  "handBack",
  "handoffUpload",
  "handoffDownload",
];

/**
 * Calls that wait on the network, git or a model: pushes, pulls and merges,
 * written commit messages, CI and plan usage. The phone gives them the
 * desktop's two minutes instead of its usual quarter.
 */
export const slowPhoneMethods: readonly PhoneDesktopMethod[] = [
  "projectGitAction",
  "projectCommitMessage",
  "projectMergePlan",
  "projectMergeBranch",
  "projectCiStatus",
  "providerUsage",
];

/** A desktop call's arguments and result, as the phone sees them. */
export type DesktopCall<M extends PhoneDesktopMethod> = {
  args: Parameters<Api[M]>;
  result: Awaited<ReturnType<Api[M]>>;
};

export type RemoteEvent =
  | { kind: "message"; chatId: string; message: ChatMessage; title?: string }
  /** Thread states moved: something started, finished or asked a question. */
  | { kind: "chats"; chats: RemoteChatSummary[] }
  | { kind: "appearance"; appearance: PhoneAppearance };

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

/** Phones leave the kind out; a computer pairs to hand threads over. */
export type DeviceKind = "computer";
/**
 * Frames inside the encrypted channel. `bridge` is the client's own
 * `remoteBridgeVersion`; clients before `compactBridge` send none.
 */
export type ClientFrame =
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
  | { t: "got"; s: number };
export type ServerFrame =
  /** `bridge` is the desktop's `remoteBridgeVersion`; desktops before `to` send none. */
  | {
      t: "paired";
      deviceId: string;
      token: string;
      name: string;
      bridge?: number;
    }
  | { t: "ready"; name: string; bridge?: number }
  | { t: "denied"; reason: string }
  | { t: "result"; id: number; ok: true; value: unknown }
  | { t: "result"; id: number; ok: false; error: string }
  /** `s` numbers a streaming frame the client acknowledges with `got`. */
  | { t: "event"; event: WireEvent; s?: number }
  /** Keepalive: a phone that stops hearing these treats the link as dead. */
  | { t: "tick" };

/** The unencrypted opening, one each way; see shared/remote-crypto. */
export interface HelloFrame {
  t: "hello";
  v: number;
  /** Ephemeral X25519 public key, base64url. */
  e: string;
}

/**
 * Tailscale on this computer. Phone access listens only on its tailnet
 * address, so a phone reaches Relay only from the same tailnet.
 */
export interface PhoneTailnet {
  /** connected: on a tailnet; stopped: installed but off or signed out; missing: not found. */
  status: "connected" | "stopped" | "missing";
  /** Its Tailscale IPv4 addresses. */
  addresses: string[];
  /** This computer's name on the tailnet, when the tailscale CLI answers. */
  name?: string;
  /** Phones on the tailnet, when the tailscale CLI answers. */
  phones?: { name: string; online: boolean }[];
}

/** The desktop's own view of phone access, for Settings. */
export interface PhoneRemoteState {
  enabled: boolean;
  listening: boolean;
  error?: string;
  port: number;
  tailnet: PhoneTailnet;
  /** Where phones reach this computer: its Tailscale addresses. */
  hosts: string[];
  devices: {
    id: string;
    name: string;
    kind?: DeviceKind;
    created: number;
    lastSeen?: number;
    online: boolean;
    /** As the phone last reported it; phones from before the report leave it out. */
    app?: PhoneAppReport;
  }[];
  /** The phone app version this Relay hands out, if it carries one. */
  phoneApp?: string;
}
export interface PhonePairing {
  url: string;
  expiresAt: number;
}
export interface PhoneRemoteApi {
  /** The window's resolved theme, passed on to paired phones. */
  phoneAppearance(appearance: PhoneAppearance): Promise<void>;
  phoneRemoteState(): Promise<PhoneRemoteState>;
  setPhoneRemote(enabled: boolean): Promise<PhoneRemoteState>;
  /** A fresh QR link; the previous one stops working. */
  phonePairing(): Promise<PhonePairing>;
  revokePhone(deviceId: string): Promise<PhoneRemoteState>;
}
