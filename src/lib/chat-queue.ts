import {
  parseCodeReferences,
  type CodeReference,
} from "../../shared/code-references";
import { pastesAfter } from "../../shared/pasted-texts";
import type { ProjectChatSend } from "../../shared/projects";
import type { DraftImage } from "./draft-images";
import { attachedImages, imagesAfter, nextImageNumber } from "./image-refs";

/** Where a dragged queued message is dropped: before or after another. */
export type QueueDrop = { id: string; where: "before" | "after" };

/** The queue with `moving` dropped on `target`, and the index it lands at; nothing when it stays put. */
export function moveQueued<T extends { input: { id: string } }>(
  queue: T[],
  moving: string,
  target: QueueDrop,
) {
  if (target.id === moving) return;
  const rest = queue.filter((q) => q.input.id !== moving),
    index =
      rest.findIndex((q) => q.input.id === target.id) +
      (target.where === "after" ? 1 : 0);
  if (queue.findIndex((q) => q.input.id === moving) === index) return;
  return {
    index,
    queue: [
      ...rest.slice(0, index),
      queue.find((q) => q.input.id === moving)!,
      ...rest.slice(index),
    ],
  };
}

/**
 * A queued message taken back into a draft that holds `draft` and `images`:
 * it goes after the draft's text, its pastes and screenshots numbered on from
 * the draft's own. Throws when the two won't fit in one message. A reply's
 * code references stay in its text: side conversations attach none.
 */
export function returnedDraft(
  draft: string,
  images: DraftImage[],
  input: ProjectChatSend,
  reply: boolean,
): { body: string; images: DraftImage[]; codeRefs: CodeReference[] } {
  const code = reply
    ? { refs: [], body: input.body }
    : parseCodeReferences(input.body);
  const back = imagesAfter(
    pastesAfter(draft, code.body),
    (input.images ?? []).map((image) => ({
      ...image,
      id: crypto.randomUUID(),
    })),
    nextImageNumber(draft, images) - 1,
  );
  const body = [draft.trim(), back.text.trim()].filter(Boolean).join("\n\n");
  if (body.length > 32000)
    throw new Error(
      "Send or shorten the current draft before restoring this message.",
    );
  const restored = [...attachedImages(draft, images), ...back.images];
  if (restored.length > 3)
    throw new Error(
      "Remove draft screenshots before restoring this message; a message can hold three.",
    );
  return { body, images: restored, codeRefs: code.refs };
}
