import { agentMentionPattern } from "./agents";
import type { ProjectChatSend } from "./projects";
import { recipient, sentAgent } from "./recipient";
import type { RemoteQueued, RemoteSettings } from "./remote";

type Image = NonNullable<ProjectChatSend["images"]>[number];

/**
 * A queued or scheduled message as the phone is told of it. The fields past
 * `images` are what taking it back needs; the screenshots themselves go on
 * request (`projectChatQueuedImages`), a megabyte each.
 */
export function queuedForPhone(q: {
  input: ProjectChatSend;
  error?: string;
}): RemoteQueued {
  const { input } = q;
  return {
    id: input.id,
    body: input.body,
    ...(input.images?.length ? { images: input.images.length } : {}),
    ...(q.error ? { error: q.error } : {}),
    ...(input.parentId ? { parentId: input.parentId } : {}),
    to: recipient(input),
    settings: {
      provider: sentAgent(input),
      choice: input.choice,
      runtimeMode: input.runtimeMode,
      interactionMode: input.interactionMode,
      ...(input.contextWindow ? { contextWindow: input.contextWindow } : {}),
    },
  };
}

/** What taking a queued message back puts in a phone's composer. */
export interface TakenBack {
  body: string;
  images: Image[];
  /** The side conversation it was sent in, by its root. */
  parentId?: string;
  /** The agent and model it was sent with; not for a note, and not from older desktops. */
  settings?: RemoteSettings;
}

/**
 * The phone composer keeps the agent in its picker, not as a mention in the
 * text, so the mention goes. An item from an older desktop has no settings
 * and no way to fetch its screenshots, and comes back as its text alone.
 */
export function takenBack(item: RemoteQueued, images: Image[] = []): TakenBack {
  const to = item.to ?? recipient(item);
  return {
    body:
      to === "message" ? item.body : item.body.replace(agentMentionPattern, ""),
    images,
    ...(item.parentId ? { parentId: item.parentId } : {}),
    ...(item.settings && to !== "message"
      ? { settings: { ...item.settings, provider: to } }
      : {}),
  };
}
