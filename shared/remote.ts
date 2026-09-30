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
  ProjectChatPatch,
  ProjectChatSend,
} from "./projects";
import type { Api, ApiMethod } from "./types";
import type { ChangeArea } from "./working-tree";

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
}

export interface RemoteProject {
  id: string;
  name: string;
  /** Its virtual sidebar folder, e.g. `Work/Frontend`. */
  folder?: string;
  scratch?: boolean;
  plain?: boolean;
}

/**
 * A project's own icon (electron/project-icon), by the hash of its data URL.
 * The data only comes along when the phone's copy is missing or stale; a
 * null hash means the project has none and keeps the folder.
 */
export type RemoteProjectIcon =
  { hash: string; dataUrl: string } | { hash: null };

/** Bumped when the bridge gains calls; a phone asks for a restart of an older desktop. */
export const remoteBridgeVersion = 7;

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
  /** Unknown until the desktop's window has applied its theme once. */
  appearance?: PhoneAppearance;
  /** Missing before version 7, and in builds made without the phone app. */
  phoneApp?: PhoneAppRelease;
  projects: RemoteProject[];
  /** Unarchived threads with messages, newest first. */
  chats: RemoteChatSummary[];
}

/** What the thread's next message goes out with, as the desktop's composer last sent it. */
export type RemoteSettings = Pick<
  ProjectChatSend,
  "provider" | "choice" | "runtimeMode" | "interactionMode" | "contextWindow"
>;

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
  /** `error`: why a steer was refused; it holds the queue until dealt with. */
  queue: { id: string; body: string; images?: number; error?: string }[];
  /** Sent with Send later, by when they go out. */
  scheduled: {
    id: string;
    body: string;
    at: number;
    images?: number;
    error?: string;
  }[];
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
 * branches), read-only files, history and background tasks; only what the
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
  "projectChatQueueAction",
  "resumeProjectChat",
  "compactProjectChat",
  "resolveStoppedWork",
  "stopProjectChatPending",
  "triageProjectChat",
  "renameProjectChat",
  "markProjectChatSeen",
  "forkProjectChat",
  "rewindProjectTurn",
  "projectChatImage",
  "projectChatReadImage",
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

/** Everything a paired phone may ask of the desktop. Nothing else is reachable. */
export interface RemoteApi {
  overview(): Promise<RemoteOverview>;
  /** The thread with its latest `history` messages, `remoteHistory` by default. */
  chat(
    id: string,
    known?: KnownMessages,
    history?: number,
  ): Promise<RemoteChat>;
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
}
export type RemoteMethod = keyof RemoteApi;
export const remoteMethods = [
  "overview",
  "chat",
  "diff",
  "desktop",
  "projectIcons",
  "phoneAppFile",
  "reportApp",
] as const satisfies readonly RemoteMethod[];

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

/** Frames inside the encrypted channel. */
export type ClientFrame =
  | { t: "pair"; code: string; device: string }
  | { t: "auth"; deviceId: string; token: string }
  | { t: "call"; id: number; method: RemoteMethod; args: unknown[] };
export type ServerFrame =
  | { t: "paired"; deviceId: string; token: string; name: string }
  | { t: "ready"; name: string }
  | { t: "denied"; reason: string }
  | { t: "result"; id: number; ok: true; value: unknown }
  | { t: "result"; id: number; ok: false; error: string }
  | { t: "event"; event: RemoteEvent }
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
