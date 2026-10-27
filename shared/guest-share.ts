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

// One plain line, so a name can't break the message header or pass for
// another: no control, format (zero-width, bidi) or separator characters.
const NAME_BREAKING = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;

/**
 * Cyrillic and Greek letters drawn like Latin ones, so "\u0421laude" can't
 * pass for "Claude" nor "\u041dost" for "Host". Read before case is folded:
 * Greek \u039d is an N, its small \u03bd a v.
 */
const LOOK_ALIKES: Record<string, string> = {
  "\u0410": "A",
  "\u0412": "B",
  "\u0421": "C",
  "\u0415": "E",
  "\u041d": "H",
  "\u0406": "I",
  "\u0408": "J",
  "\u041a": "K",
  "\u041c": "M",
  "\u041e": "O",
  "\u0420": "P",
  "\u0405": "S",
  "\u0422": "T",
  "\u0425": "X",
  "\u0423": "Y",
  "\u0430": "a",
  "\u0441": "c",
  "\u0501": "d",
  "\u0435": "e",
  "\u04bb": "h",
  "\u0456": "i",
  "\u0458": "j",
  "\u04cf": "l",
  "\u043e": "o",
  "\u0440": "p",
  "\u0455": "s",
  "\u051d": "w",
  "\u0445": "x",
  "\u0443": "y",
  "\u0391": "A",
  "\u0392": "B",
  "\u0395": "E",
  "\u0397": "H",
  "\u0399": "I",
  "\u039a": "K",
  "\u039c": "M",
  "\u039d": "N",
  "\u039f": "O",
  "\u03a1": "P",
  "\u03a4": "T",
  "\u03a5": "Y",
  "\u03a7": "X",
  "\u0396": "Z",
  "\u03b1": "a",
  "\u03b5": "e",
  "\u03b9": "i",
  "\u03ba": "k",
  "\u03bd": "v",
  "\u03bf": "o",
  "\u03c1": "p",
  "\u03c4": "t",
  "\u03c5": "u",
};

/** A name as it reads: compatibility forms folded, look-alike letters and case ignored. */
const asRead = (name: string) =>
  [...name.normalize("NFKC")]
    .map((c) => LOOK_ALIKES[c] ?? c)
    .join("")
    .toLowerCase();

/**
 * Whether a guest's message would read as the host's or an agent's under
 * this name. "You" is how the host's own messages are headed.
 */
const someoneElsesName = (name: string) =>
  ["Host", "You", ...agentProviders.map(agentName)].some(
    (taken) => asRead(taken) === asRead(name),
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
  /** Where its pages load from: an address of their own, so a page never holds the link. */
  key: string;
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

/** The latest time a Date can stand for. */
const MAX_DATE = 8_640_000_000_000_000;

/** What a bundle's title and authors may run to; longer ones are cut before sending. */
export const BUNDLE_TITLE_CHARS = 300;
export const BUNDLE_AUTHOR_CHARS = 100;

/** What a guest's own Relay downloads to carry the conversation on. */
export const guestBundleSchema = z.object({
  title: z.string().max(BUNDLE_TITLE_CHARS),
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        from: z.string().max(BUNDLE_AUTHOR_CHARS),
        body: z.string().max(200_000),
        // Within what a Date can hold, even once moved back for the sharer's clock.
        created: z.number().int().min(0).max(MAX_DATE),
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
