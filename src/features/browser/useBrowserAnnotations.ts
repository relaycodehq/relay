import { useEffect, useRef } from "react";
import { api } from "../../lib/api";
import {
  loadDraftImages,
  updateDraftImages,
  prepareScreenshot,
  onDraftImagesSaved,
  onDraftImagesChanged,
  type DraftImage,
} from "../images/draft-images";
import { attachedImages } from "../../../shared/image-refs";
import { readDraftText } from "../../lib/thread-storage";
import { dataUrlFile } from "../images/image-drag";

/** The draft's comments the inspector shows. */
function inspected(draftKey: string, images: DraftImage[]) {
  const attached = attachedImages(readDraftText(draftKey), images);
  const annotations = attached.flatMap((image) =>
    image.browser ? [image.browser] : [],
  );
  return { annotations, shown: JSON.stringify(annotations) };
}

/** Keeps browser edits in the same durable draft store as other screenshots. */
export function useBrowserAnnotations(
  key: string,
  draftKey: string,
  front: boolean,
  onError: (error: string | null) => void,
) {
  const inspection = useRef(0);
  const waiting = useRef(false);
  const refresh = useRef(false);
  const shown = useRef("");
  useEffect(() => {
    // Restarting drops a comment being typed, so only for a change the inspector would show.
    const changed = (changedKey: string) => {
      if (changedKey !== draftKey || !waiting.current) return;
      void loadDraftImages(draftKey)
        .then((images) => {
          if (
            !waiting.current ||
            inspected(draftKey, images).shown === shown.current
          )
            return;
          refresh.current = true;
          void api.previewAction(key, "stopPicking").catch(() => {});
        })
        .catch(() => {});
    };
    const off = onDraftImagesSaved(changed);
    const offOtherWindow = onDraftImagesChanged(changed);
    return () => {
      off();
      offOtherWindow();
    };
  }, [key, draftKey]);
  useEffect(
    () => () => {
      inspection.current++;
      void api.previewAction(key, "stopPicking").catch(() => {});
    },
    [key, draftKey, front],
  );
  async function inspect() {
    const sequence = ++inspection.current;
    onError(null);
    try {
      while (sequence === inspection.current) {
        const now = inspected(draftKey, await loadDraftImages(draftKey));
        if (sequence !== inspection.current) return;
        refresh.current = false;
        waiting.current = true;
        shown.current = now.shown;
        const change = await api.pickPreviewElement(key, now.annotations);
        waiting.current = false;
        if (!change) {
          if (refresh.current) continue;
          return;
        }
        // Keep a completed edit in its original thread even if navigation changed meanwhile.
        if (change.action === "remove") {
          await updateDraftImages(draftKey, (now) =>
            now.filter((image) => image.browser?.id !== change.id),
          );
        } else {
          const file = dataUrlFile(change.image, "Browser comment.png");
          if (!file)
            throw new Error("Could not read the element's screenshot.");
          const image = await prepareScreenshot(file);
          await updateDraftImages(draftKey, (now) => {
            return [
              ...now.filter(
                (existing) => existing.browser?.id !== change.annotation.id,
              ),
              // A new revision gets its own image id: an in-flight send only clears its old copy.
              { ...image, browser: change.annotation },
            ];
          });
        }
      }
    } catch (error) {
      waiting.current = false;
      if (sequence === inspection.current)
        onError(
          error instanceof Error
            ? error.message
            : "Could not save the browser comment.",
        );
    }
  }
  return inspect;
}
