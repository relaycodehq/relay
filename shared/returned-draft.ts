import { parseCodeReferences, type CodeReference } from "./code-references";
import { attachedImages, imagesAfter, nextImageNumber } from "./image-refs";
import { pastesAfter } from "./pasted-texts";
import type { ProjectChatSend } from "./projects";

/** A screenshot in a draft: `n` is its `[Image #n]` token, see image-refs. */
export type ReturnedImage = NonNullable<ProjectChatSend["images"]>[number] & {
  id: string;
  n?: number;
};

/**
 * A queued message taken back into a draft that holds `draft` and `images`:
 * it goes after the draft's text, its pastes and screenshots numbered on from
 * the draft's own. Throws when the two won't fit in one message. A reply's
 * code references stay in its text: side conversations attach none. `newId`
 * names the message's screenshots as they join the draft.
 */
export function returnedDraft(
  draft: string,
  images: ReturnedImage[],
  input: Pick<ProjectChatSend, "body" | "images">,
  reply: boolean,
  newId: () => string,
): { body: string; images: ReturnedImage[]; codeRefs: CodeReference[] } {
  const code = reply
    ? { refs: [], body: input.body }
    : parseCodeReferences(input.body);
  const back = imagesAfter(
    pastesAfter(draft, code.body),
    (input.images ?? []).map((image) => ({ ...image, id: newId() })),
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
