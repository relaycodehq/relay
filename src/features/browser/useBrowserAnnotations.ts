import { useEffect, useRef } from "react";
import { api } from "../../lib/api";
import {
  loadDraftImages,
  updateDraftImages,
  prepareScreenshot,
  onDraftImagesSaved,
  onDraftImagesChanged,
} from "../images/draft-images";
import { attachedImages } from "../../../shared/image-refs";
import { readDraftText } from "../../lib/thread-storage";

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
  useEffect(() => {
    const changed = (changedKey: string) => {
      if (changedKey !== draftKey || !waiting.current) return;
      refresh.current = true;
      void api.previewAction(key, "stopPicking").catch(() => {});
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
        const images = await loadDraftImages(draftKey);
        const attached = attachedImages(readDraftText(draftKey), images);
        const annotations = attached.flatMap((image) =>
          image.browser ? [image.browser] : [],
        );
        if (sequence !== inspection.current) return;
        refresh.current = false;
        waiting.current = true;
        const change = await api.pickPreviewElement(
          key,
          annotations,
          Math.max(0, 3 - attached.length),
        );
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
          const bytes = Uint8Array.from(
            atob(change.image.split(",")[1] ?? ""),
            (c) => c.charCodeAt(0),
          );
          const image = await prepareScreenshot(
            new File([bytes], "Browser comment.png", { type: "image/png" }),
          );
          await updateDraftImages(draftKey, (now) => {
            const kept = attachedImages(readDraftText(draftKey), now);
            const replacing = kept.some(
              (image) => image.browser?.id === change.annotation.id,
            );
            if (!replacing && kept.length >= 3)
              throw new Error(
                "Send or remove an attachment before adding another browser comment. A message holds three screenshots.",
              );
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
