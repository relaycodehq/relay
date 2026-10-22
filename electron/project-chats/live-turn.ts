import type { ChatMessage, ProjectChat } from "../../shared/projects";

// A thread's file is rewritten whole on every save, and a long thread's is
// megabytes, nearly all of it earlier turns' traces. While a turn streams,
// its checkpoints go to a small file beside it instead: what the turn changed
// since the last full save, which is mostly its answer.

/**
 * Whether every checkpoint makes sure the messages it leaves out are as they
 * were saved; the unit tests turn it on, as it costs a copy of each message.
 */
const checking = () => process.env.RELAY_CHECK_CHECKPOINTS === "1";

/** What a full save wrote, to tell a checkpoint which messages changed since. */
export interface SavedBase {
  /** The full file's mark; a live turn applies only over the file it was written for. */
  rev: number;
  /** The full file's size, to fall back to a full save once the turn changed much of it. */
  bytes: number;
  /** Each message as it was written, by id: the object and its version, and with checks on, its text. */
  messages: Map<
    string,
    { message: ChatMessage; version: number; json?: string }
  >;
}

/** A turn's progress since the full save `base`: `<id>.live.json`. */
export interface LiveTurn {
  base: number;
  /** The thread's own fields as they stand, everything but its messages. */
  chat: Omit<ProjectChat, "messages" | "links">;
  /** Every message's id, in order. */
  order: string[];
  /** The messages added or changed since the full save. */
  messages: ChatMessage[];
}

export function savedBase(
  chat: ProjectChat,
  rev: number,
  bytes: number,
): SavedBase {
  return {
    rev,
    bytes,
    messages: new Map(
      chat.messages.map((m) => [
        m.id,
        {
          message: m,
          version: m.version,
          ...(checking() ? { json: JSON.stringify(m) } : {}),
        },
      ]),
    ),
  };
}

/**
 * The turn's progress over `base`. A message counts as changed when it's a
 * different object or its version moved, which every change to one that
 * shows does: the window redraws a message by its version.
 */
export function liveTurn(chat: ProjectChat, base: SavedBase): LiveTurn {
  const { messages, links: _, ...own } = chat;
  return {
    base: base.rev,
    chat: own,
    order: messages.map((m) => m.id),
    messages: messages.filter((m) => {
      const saved = base.messages.get(m.id);
      const changed = saved?.message !== m || saved.version !== m.version;
      if (
        !changed &&
        saved.json !== undefined &&
        saved.json !== JSON.stringify(m)
      )
        throw new Error(
          `Message ${m.id} changed without its version moving, so a checkpoint would leave the change out.`,
        );
      return changed;
    }),
  };
}

/** The thread with the turn's progress over it, when `live` was written over this very file. */
export function withLiveTurn(
  chat: ProjectChat,
  rev: number | undefined,
  live: LiveTurn | undefined,
): ProjectChat {
  if (!live || live.base !== rev) return chat;
  const byId = new Map(chat.messages.map((m) => [m.id, m]));
  for (const m of live.messages) byId.set(m.id, m);
  return {
    ...live.chat,
    id: chat.id,
    messages: live.order.flatMap((id) => byId.get(id) ?? []),
  } as ProjectChat;
}
