import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { isAbsolute, join, normalize, parse, sep } from "node:path";
import { readTurn } from "../../shared/agent-trace";
import { agentMentionPattern, agentName } from "../../shared/agents";
import {
  answerImagePaths,
  answerVideoPaths,
  bracketSpacedImagePaths,
  localImagePath,
  localVideoPath,
} from "../../shared/answer-images";
import type {
  GuestActivity,
  GuestMessage,
  GuestShareContents,
  GuestThreadView,
} from "../../shared/guest-share";
import { resolveFileLink } from "../../shared/markdown-links";
import type { ChatMessage, ProjectChat } from "../../shared/projects";
import { mainConversation, threadOrder } from "../../shared/projects/messages";
import { redacted } from "../../shared/redact-secrets";
import { guestHtml } from "./markdown";
import { sharedFiles, touchesSecrets, type SharedFile } from "./shared-files";

/** What the snapshot reads beyond the thread itself; TurnFiles in the app. */
export interface ThreadMedia {
  image(chatId: string, imageId: string): Promise<string>;
  readImage(chatId: string, messageId: string, path: string): Promise<string>;
  previewShot(chatId: string, messageId: string): Promise<string>;
  turnVideoPath(
    chatId: string,
    messageId: string,
    path: string,
  ): Promise<string>;
}

export type GuestMediaSource =
  | { kind: "image"; dataUrl: () => Promise<string> }
  | { kind: "video"; path: () => Promise<string> };

/** A thread as its guests see it, with what each of its links may load. */
export interface GuestSnapshot {
  view: GuestThreadView;
  media: Map<string, GuestMediaSource>;
  files: Map<string, SharedFile>;
  /** A tool call's output, by `messageId/activityId`, redacted. */
  details: Map<string, string>;
  /** Pages a render has, by render id. */
  renders: Map<string, number>;
  contents: GuestShareContents;
  /** The messages the view shows, as the thread holds them, for carrying the conversation on. */
  conversation: ChatMessage[];
  /** The thread's folder, left out of paths the guest reads. */
  root: string | null;
}

/** A guest's page shows this many of the newest messages. */
export const GUEST_HISTORY = 200;
/** Longer bodies are cut, so one huge answer can't make every update heavy. */
export const GUEST_BODY_CHARS = 20_000;

/**
 * The conversation as a guest may read it: the main thread's prompts and
 * replies with secrets redacted, without side questions or Relay's own
 * markers. Pictures the agent only looked at stay out; ones the thread shows
 * (sent with a message, embedded in an answer, the preview's frame) go in.
 */
export async function guestSnapshot(
  thread: ProjectChat,
  root: string | null,
  media: ThreadMedia,
  endsAt: number,
  /** The address a render's page is loaded from, which carries no link token. */
  renderKey: (renderId: string) => string,
): Promise<GuestSnapshot> {
  const conversation = guestConversation(thread.messages);
  // Asides stay private, and so do the files only they touched.
  const shown = mainConversation(thread.messages).filter((m) => !isAside(m));
  const files = await sharedFiles(shown, root);
  const snapshot: GuestSnapshot = {
    view: {
      // Titles start as the first prompt's words, keys and paths included.
      title: withoutHostPaths(redacted(thread.title), root),
      running: !!thread.running,
      endsAt,
      messages: [],
      files: [],
    },
    media: new Map(),
    files: new Map(files.map((f) => [f.id, f])),
    details: new Map(),
    renders: new Map(),
    contents: {
      files: files.length,
      bytes: 0,
      images: 0,
      videos: 0,
      renders: 0,
    },
    conversation,
    root,
  };
  const shared = {
    renderKey,
    byPath: new Map(files.map((f) => [f.absolute, f.id])),
    // A link to a file renders differently once that file is shared.
    key: createHash("sha1")
      .update(files.map((f) => f.id).join())
      .digest("base64url"),
  };
  for (const m of conversation)
    snapshot.view.messages.push(
      guestMessage(thread.id, m, root, media, shared, snapshot),
    );
  snapshot.view.files = files.map(({ id, path, bytes, changed }) => ({
    id,
    path,
    bytes,
    changed,
  }));
  snapshot.contents.bytes = files.reduce((sum, f) => sum + f.bytes, 0);
  for (const source of snapshot.media.values())
    snapshot.contents[source.kind === "image" ? "images" : "videos"]++;
  snapshot.contents.renders = snapshot.renders.size;
  return snapshot;
}

export function guestConversation(messages: ChatMessage[]) {
  return mainConversation(messages)
    .sort(threadOrder)
    .filter(isConversation)
    .slice(-GUEST_HISTORY);
}

function isConversation(m: ChatMessage) {
  const relayMarker =
    m.compaction ||
    m.handoff ||
    m.reload ||
    m.worktreeCommand ||
    m.resumed ||
    m.handedOver;
  const empty =
    !m.body.trim() &&
    m.status !== "streaming" &&
    !m.renders?.length &&
    !m.images?.length;
  return !relayMarker && !isAside(m) && !empty;
}

const isAside = (m: ChatMessage) => !!(m.side || m.asyncQuestionAnswer);

/** Another thread's author names it by its title, which can hold anything a title can. */
export const guestAuthor = (m: ChatMessage) =>
  m.role === "user" ? redacted(m.author ?? "Host") : agentName(m.provider);

function guestMessage(
  chatId: string,
  m: ChatMessage,
  root: string | null,
  media: ThreadMedia,
  shared: {
    renderKey: (renderId: string) => string;
    byPath: Map<string, string>;
    key: string;
  },
  snapshot: GuestSnapshot,
): GuestMessage {
  const own = (kind: string, key: string) => mediaId(m.id, kind, key);
  const answerMedia = answerMediaOf(chatId, m, root, media, snapshot);
  const html = renderedBody(m, shared.key, root, {
    media: (src) => {
      if (!root) return undefined;
      const path = localImagePath(src, root) ?? localVideoPath(src, root);
      return path ? answerMedia.get(path) : undefined;
    },
    file: (href) => {
      const link = resolveFileLink(href);
      if (!link) return undefined;
      const path = isAbsolute(link.path)
        ? normalize(link.path)
        : root && join(root, link.path);
      return path ? shared.byPath.get(path) : undefined;
    },
  });
  const images = (m.images ?? []).map((image) => {
    const id = own("sent", image.id);
    snapshot.media.set(id, {
      kind: "image",
      dataUrl: () => media.image(chatId, image.id),
    });
    return id;
  });
  let preview: string | undefined;
  if (m.preview?.shot) {
    preview = own("preview", "frame");
    snapshot.media.set(preview, {
      kind: "image",
      dataUrl: () => media.previewShot(chatId, m.id),
    });
  }
  for (const r of m.renders ?? []) snapshot.renders.set(r.id, r.pages.length);
  const activities = guestActivities(m, root, snapshot);
  return {
    id: m.id,
    from: guestAuthor(m),
    role: m.role,
    created: m.created,
    ...(m.role === "assistant" && m.provider ? { provider: m.provider } : {}),
    html,
    streaming: m.status === "streaming",
    ...(activities.length ? { activities } : {}),
    ...(m.renders?.length
      ? { renders: guestRenders(m.renders, shared.renderKey) }
      : {}),
    ...(images.length ? { images } : {}),
    ...(preview ? { preview } : {}),
  };
}

/** Images and videos an answer names on this computer, by path. */
function answerMediaOf(
  chatId: string,
  m: ChatMessage,
  root: string | null,
  media: ThreadMedia,
  snapshot: GuestSnapshot,
): Map<string, { id: string; kind: "image" | "video" }> {
  const found = new Map<string, { id: string; kind: "image" | "video" }>();
  // A copied answer naming a path names one on someone else's computer.
  if (m.role !== "assistant" || !root || m.imported) return found;
  for (const path of answerImagePaths(m.body, root)) {
    const id = mediaId(m.id, "image", path);
    found.set(path, { id, kind: "image" });
    snapshot.media.set(id, {
      kind: "image",
      dataUrl: () => media.readImage(chatId, m.id, path),
    });
  }
  for (const path of answerVideoPaths(m.body, root)) {
    const id = mediaId(m.id, "video", path);
    found.set(path, { id, kind: "video" });
    snapshot.media.set(id, {
      kind: "video",
      path: () => media.turnVideoPath(chatId, m.id, path),
    });
  }
  return found;
}

function guestRenders(
  renders: NonNullable<ChatMessage["renders"]>,
  renderKey: (renderId: string) => string,
) {
  return renders.map(({ id, title, pages }) => ({
    id,
    key: renderKey(id),
    title: redacted(title),
    pages: pages.map(({ label, heights }) => ({
      ...(label ? { label: redacted(label) } : {}),
      ...(heights ? { heights } : {}),
    })),
  }));
}

function guestActivities(
  m: ChatMessage,
  root: string | null,
  snapshot: GuestSnapshot,
): GuestActivity[] {
  if (m.role !== "assistant") return [];
  return readTurn(m).activity.map((a) => {
    // A call on a key file keeps its line; what it printed stays here.
    const shown = !!a.detail && !touchesSecrets(a.label);
    if (shown)
      snapshot.details.set(
        `${m.id}/${a.id}`,
        withoutHostPaths(redacted(a.detail!), root),
      );
    return {
      id: a.id,
      kind: a.kind,
      label: withoutHostPaths(redacted(a.label), root).slice(0, 300),
      status: a.status,
      detail: shown,
    };
  });
}

/** `text` with the thread's folder left out and the home folder as `~`, so guests don't read the host's paths. */
export function withoutHostPaths(text: string, root: string | null) {
  const inRoot = root ? text.split(`${root}${sep}`).join("") : text;
  const home = homedir();
  // A home folder at the top of the disk would turn every slash into ~.
  if (home === parse(home).root) return inRoot;
  return inRoot.replace(homeFolder(home), "~");
}

/** The home folder as a whole name: not `/home/al` inside `/home/alex`. */
function homeFolder(home: string) {
  const escaped = home.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`${escaped}(?![\\w.-])`, "g");
}

// Markdown is parsed once per version of a message, not on every update;
// only its latest version is kept, as a streaming answer has a new one a second.
const rendered = new Map<string, { key: string; html: string }>();

function renderedBody(
  m: ChatMessage,
  sharedKey: string,
  root: string | null,
  links: Parameters<typeof guestHtml>[1],
) {
  const key = `${m.version}:${m.status}:${m.body.length}:${sharedKey}:${root}`;
  const cached = rendered.get(m.id);
  if (cached?.key === key) return cached.html;
  // Paths go after links are read, which name files by their full path.
  // A picture's path with spaces is read as the app reads it.
  const markdown = bracketSpacedImagePaths(guestBody(shownBody(m)));
  const html = withoutHostPaths(guestHtml(markdown, links), root);
  if (rendered.size > 5000) rendered.delete(rendered.keys().next().value!);
  rendered.delete(m.id);
  rendered.set(m.id, { key, html });
  return html;
}

/** What the app shows of a message: a leading `@claude` only picks who answers. */
const shownBody = (m: ChatMessage) =>
  m.role === "user" ? m.body.replace(agentMentionPattern, "") : m.body;

export function guestBody(body: string) {
  const clean = redacted(body);
  if (clean.length <= GUEST_BODY_CHARS) return clean;
  return `${clean.slice(0, GUEST_BODY_CHARS)}\n\n… (cut for the shared view)`;
}

const mediaId = (messageId: string, kind: string, key: string) =>
  createHash("sha256")
    .update(`${messageId}\0${kind}\0${key}`)
    .digest("base64url")
    .slice(0, 16);
