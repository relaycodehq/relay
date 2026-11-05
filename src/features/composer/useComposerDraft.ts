import { useEffect, useMemo, useState, type RefObject } from "react";
import { agentMentionPattern } from "../../../shared/agents";
import { pastedTexts } from "../../../shared/pasted-texts";
import { pickedSkills } from "../../../shared/skill-mentions";
import { unsent } from "../../../shared/drafts";
import { draftChips } from "../../lib/thread-storage";
import type { DraftImage } from "../images/draft-images";
import { useImagePills } from "../images/image-pills";
import { readDraft, useDraft, writeDraft } from "./drafts";
import { draftIntake, PASTE_TOO_LONG, type DraftEditor } from "./draft-intake";
import { useDraftImages } from "./useDraftImages";
import { usePreparationQueue } from "./usePreparationQueue";

export type { DraftEditor } from "./draft-intake";
export type ComposerDraft = ReturnType<typeof useComposerDraft>;

/** The draft's text, persisted screenshots and incoming attachments. */
export function useComposerDraft(
  key: string,
  editor: RefObject<DraftEditor | null>,
) {
  const text = useDraft(key);
  const set = (value: string) => writeDraft(key, value);
  const [error, setError] = useState<string>();
  const queue = usePreparationQueue(setError);
  const screenshots = useDraftImages(key, text, setError);
  const imagePills = useImagePills();
  // Paste pills live in the draft text; their cards mirror them in order.
  const pastes = useMemo(() => pastedTexts(text), [text]);
  // A refused paste leaves the draft as it was; the next edit moves on from it.
  useEffect(() => {
    setError((error) => (error === PASTE_TOO_LONG ? undefined : error));
  }, [text]);
  const intake = draftIntake({
    key,
    editor,
    screenshots,
    imagePills,
    setError,
    queuePreparation: queue.queuePreparation,
  });
  return {
    text,
    set,
    images: screenshots.images,
    attached: screenshots.attached,
    chips: screenshots.chips,
    pastes,
    /** What went wrong bringing something in, or sending it. */
    error,
    setError,
    ...intake,
    preparing: queue.preparing,
    incoming: queue.incoming,
    isPreparing: queue.isPreparing,
    sketching: screenshots.sketching,
    sketch: screenshots.sketch,
    historyOf: screenshots.historyOf,
    finishSketch: screenshots.finishSketch,
    /** An agent was picked, so an @mention would only override it. */
    dropMention() {
      const prefix = agentMentionPattern.exec(text.trimStart())?.[0];
      if (prefix)
        editor.current?.insertText({
          start: 0,
          end: text.length - text.trimStart().length + prefix.length,
          text: "",
        });
    },
    removeImage(image: DraftImage) {
      if (image.n !== undefined) editor.current?.removeImage(image.n);
      screenshots.removeImage(image);
    },
    /** The skills picked as pills that `text` still mentions. */
    skills: (text: string) => pickedSkills(text, draftChips(key).skills.load()),
    /**
     * Empties the composer as the message goes out; a message that is turned
     * down comes back, ahead of anything typed since.
     */
    take(withImages: boolean) {
      let taken: string | undefined;
      const outgoingImages = withImages ? screenshots.take() : undefined;
      return {
        dispatch() {
          taken = text;
          // Typed while the message was being readied: it stays for the next one.
          set(unsent(readDraft(key), text.trim()));
          outgoingImages?.dispatch();
        },
        restore() {
          if (taken === undefined) return;
          const typed = readDraft(key).trim();
          set(typed ? `${taken.trimEnd()}\n\n${typed}` : taken);
          outgoingImages?.restore();
        },
        /** The message went: its screenshots' draft copies go, any pasted since stay. */
        async forget() {
          await outgoingImages?.forget();
        },
      };
    },
  };
}
