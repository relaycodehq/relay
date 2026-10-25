import { z } from "zod";
import { agentName, agentProviders } from "./agents";
import type { AgentActivity } from "./projects/messages";

/**
 * Share with guest: a link someone outside Relay opens in a browser to follow
 * one thread, read the files its agents changed and read, and suggest
 * messages. Nothing a guest writes reaches the agent until the person at this
 * computer sends it.
 */

/** How long a link lives unless it's stopped first. */
export const GUEST_SHARE_HOURS = 24;

/** Where the guest's link points, as far as this computer could make one. */
export type GuestReach =
  | { public: true; url: string }
  /** No public link: why not, and Tailscale's page to fix it when it named one. */
  | { public: false; reason: string; fixUrl?: string };

/** What a link lets its guests see, counted for the dialog. */
export interface GuestShareContents {
  files: number;
  bytes: number;
  images: number;
  videos: number;
  renders: number;
}

export interface GuestShare {
  threadId: string;
  reach: GuestReach;
  /** The same page on this computer, to see what the guest sees. */
  localUrl: string;
  startedAt: number;
  endsAt: number;
  contents: GuestShareContents;
}

export interface GuestSuggestion {
  id: string;
  threadId: string;
  /** What the guest called themselves; anyone with the link can type any name. */
  name: string;
  text: string;
  at: number;
  /** `drafted`: the host took it into their own draft. */
  status: "waiting" | "sent" | "drafted" | "dismissed";
}

export type GuestShareEvent =
  | { kind: "share"; threadId: string; share: GuestShare | null }
  | { kind: "suggestions"; threadId: string; suggestions: GuestSuggestion[] };

export interface GuestShareApi {
  /** The thread's live link, if it has one. */
  guestShare(threadId: string): Promise<GuestShare | null>;
  /** Makes the thread's link, or hands back the one it has. */
  startGuestShare(threadId: string): Promise<GuestShare>;
  stopGuestShare(threadId: string): Promise<void>;
  /** Suggestions still waiting for the host to send or dismiss. */
  guestSuggestions(threadId: string): Promise<GuestSuggestion[]>;
  /** Runs the suggestion as a turn in the guest's name, with the thread's last settings. */
  sendGuestSuggestion(id: string): Promise<void>;
  /** Takes it off the list: dismissed, or put in the host's own draft. */
  resolveGuestSuggestion(
    id: string,
    status: "drafted" | "dismissed",
  ): Promise<void>;
  /** Copies a thread someone shared into a new thread of `projectId`; its summary. */
  importGuestThread(
    projectId: string,
    link: string,
  ): Promise<import("./projects").ChatSummary>;
  onGuestShare(callback: (event: GuestShareEvent) => void): () => void;
}

export const MAX_SUGGESTION_CHARS = 4000;
export const MAX_GUEST_NAME_CHARS = 40;

// One plain line, so a name can't break the message header or pass for another.
const NAME_BREAKING = /[\p{Cc}\p{Zl}\p{Zp}؜‎‏‪-‮⁦-⁩]/u;

/** Whether a guest's message would read as the host's or an agent's under this name. */
const someoneElsesName = (name: string) =>
  ["Host", ...agentProviders.map(agentName)].some(
    (taken) => taken.toLowerCase() === name.toLowerCase(),
  );

export const guestNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(MAX_GUEST_NAME_CHARS)
  .refine((name) => !NAME_BREAKING.test(name), "Use one plain line.")
  .refine((name) => !someoneElsesName(name), "Pick a name of your own.");

export const guestSuggestionInput = z
  .object({
    guestId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
    name: guestNameSchema,
    text: z.string().trim().min(1).max(MAX_SUGGESTION_CHARS),
  })
  .strict();

/** A tool call as a guest sees it: its line, and whether there's output to open. */
export interface GuestActivity {
  id: string;
  kind: AgentActivity["kind"];
  label: string;
  status: AgentActivity["status"];
  detail: boolean;
}

export interface GuestRender {
  id: string;
  title: string;
  pages: { label?: string; heights?: number[] }[];
}

export interface GuestMessage {
  id: string;
  /** "Host", the agent's name, or the guest whose suggestion it was. */
  from: string;
  role: "user" | "assistant";
  /** The body as HTML Relay built from its markdown; nothing in it runs. */
  html: string;
  streaming: boolean;
  activities?: GuestActivity[];
  renders?: GuestRender[];
  /** Media ids: pictures sent with the message, and the preview's frame. */
  images?: string[];
  preview?: string;
}

/** A file the thread's agents changed or read, readable through the link. */
export interface GuestFile {
  id: string;
  path: string;
  bytes: number;
  changed: boolean;
}

export interface GuestThreadView {
  title: string;
  running: boolean;
  endsAt: number;
  messages: GuestMessage[];
  files: GuestFile[];
}

/** What one guest's page holds: the thread, and what became of their suggestions. */
export interface GuestPageView extends GuestThreadView {
  suggestions: { text: string; status: GuestSuggestion["status"] }[];
}

/** A change to a guest's page since the last one it had. */
export interface GuestDelta {
  title: string;
  running: boolean;
  /** Message ids in order; ones not in `messages` the page already has. */
  order: string[];
  messages: GuestMessage[];
  files?: GuestFile[];
  suggestions?: GuestPageView["suggestions"];
}

/** What a guest's own Relay downloads to carry the conversation on. */
export const guestBundleSchema = z.object({
  title: z.string().max(300),
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        from: z.string().max(100),
        body: z.string().max(200_000),
        created: z.number(),
      }),
    )
    .max(500),
  files: z
    .array(z.object({ path: z.string().max(1000), content: z.string() }))
    .max(20),
});

export type GuestBundle = z.infer<typeof guestBundleSchema>;

/** The deep link a guest page opens to carry on in the guest's own Relay. */
export const guestImportUrl = (link: string) =>
  `relay://guest?link=${encodeURIComponent(link)}`;

/** The share link inside one, if it is one and points at a guest page. */
export function guestImportLink(url: string): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== "relay:" || parsed.host !== "guest") return;
  const link = parsed.searchParams.get("link");
  return link && guestLinkProblem(link) === undefined ? link : undefined;
}

/** Why `link` can't be a guest page: https anywhere, or http on this computer. */
export function guestLinkProblem(link: string): string | undefined {
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return "That isn't a link.";
  }
  const local = url.hostname === "127.0.0.1" || url.hostname === "localhost";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local))
    return "Guest links are https.";
  if (url.username || url.password) return "That isn't a guest link.";
  if (!/\/g\/[A-Za-z0-9_-]{43}\/?$/.test(url.pathname))
    return "That isn't a guest link.";
  return undefined;
}
