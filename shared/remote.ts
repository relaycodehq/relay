/**
 * Relay's phone remote: a phone pairs with the desktop over the local network
 * (or a VPN such as Tailscale) and drives its threads. The desktop hosts the
 * bridge; the phone only ever talks to it. Pure types and helpers, so the
 * phone app can import this file without the desktop's dependencies.
 */
import type { AgentResponse, RuntimeMode } from "./agent-modes";
import type { AgentProvider } from "./agents";
import type {
  ChatMessage,
  ChatPending,
  ChatScope,
  KnownMessages,
  ProjectChatPatch,
} from "./projects";

export const remoteProtocol = 1;
export const remoteScheme = "relay-remote";
export const defaultRemotePort = 47821;

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
  branch?: string;
  worktree?: boolean;
  pending?: ChatPending[];
  empty?: boolean;
}

export interface RemoteProject {
  id: string;
  name: string;
  scratch?: boolean;
  plain?: boolean;
}

export interface RemoteOverview {
  name: string;
  projects: RemoteProject[];
  /** Unarchived threads with messages, newest first. */
  chats: RemoteChatSummary[];
}

/** A thread, with messages the phone already holds at the same version sent as ids. */
export interface RemoteChat extends Pick<
  ProjectChatPatch,
  "id" | "projectId" | "title" | "messages" | "requests" | "queuePaused"
> {
  running: boolean;
  /** The folder the thread works in; tool labels drop it, as on the desktop. Older desktops leave it out. */
  root?: string;
  /** Older messages left on the desktop; a phone gets the latest `remoteHistory`. */
  earlier: number;
  queue: { id: string; body: string }[];
  /** The agent the next message goes to, and how it may act. */
  agent?: { provider: AgentProvider; runtimeMode: RuntimeMode };
}

export const remoteHistory = 100;

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

export interface RemoteNewChat {
  id: string;
  body: string;
  provider: AgentProvider;
  runtimeMode: RuntimeMode;
}

/** Everything a paired phone may ask of the desktop. Nothing else is reachable. */
export interface RemoteApi {
  overview(): Promise<RemoteOverview>;
  chat(id: string, known?: KnownMessages): Promise<RemoteChat>;
  send(
    chatId: string,
    message: { id: string; body: string; parentId?: string },
  ): Promise<void>;
  startChat(
    projectId: string,
    input: RemoteNewChat,
  ): Promise<RemoteChatSummary>;
  stop(chatId: string): Promise<void>;
  respond(
    chatId: string,
    requestId: string,
    response: AgentResponse,
  ): Promise<void>;
  turnDiff(
    chatId: string,
    messageId: string,
    path: string,
  ): Promise<RemoteDiff>;
  settle(chatId: string, settled: boolean): Promise<void>;
}
export type RemoteMethod = keyof RemoteApi;
export const remoteMethods = [
  "overview",
  "chat",
  "send",
  "startChat",
  "stop",
  "respond",
  "turnDiff",
  "settle",
] as const satisfies readonly RemoteMethod[];

export type RemoteEvent =
  | { kind: "message"; chatId: string; message: ChatMessage; title?: string }
  /** Thread states moved: something started, finished or asked a question. */
  | { kind: "chats"; chats: RemoteChatSummary[] };

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

/** The desktop's own view of phone access, for Settings. */
export interface PhoneRemoteState {
  enabled: boolean;
  listening: boolean;
  error?: string;
  port: number;
  /** Where phones reach this computer, best first. */
  hosts: string[];
  devices: {
    id: string;
    name: string;
    created: number;
    lastSeen?: number;
    online: boolean;
  }[];
}
export interface PhonePairing {
  url: string;
  expiresAt: number;
}
export interface PhoneRemoteApi {
  phoneRemoteState(): Promise<PhoneRemoteState>;
  setPhoneRemote(enabled: boolean): Promise<PhoneRemoteState>;
  /** A fresh QR link; the previous one stops working. */
  phonePairing(): Promise<PhonePairing>;
  revokePhone(deviceId: string): Promise<PhoneRemoteState>;
}
