import { useEffect, useState } from "react";
import { imageBridge } from "../../../../shared/remote";
import { outgoingImage } from "../../remote/outbox";
import { useRemote } from "../../remote/RemoteProvider";
import { ImageCache } from "./image-cache";

export type Source =
  | { kind: "attached"; chatId: string; imageId: string }
  | { kind: "read"; chatId: string; messageId: string; path: string }
  /** Pasted into a message still on its way; the outbox holds it. */
  | { kind: "pending"; messageId: string; index: number };

// Data URLs by source and size, so scrolling back doesn't fetch them again.
const cache = new ImageCache();
// Ones the desktop refused, so the lightbox skips them as the desktop's does.
const failed = new Set<string>();
export const keyOf = (s: Source) => JSON.stringify(s);
const scopedKey = (s: Source, computer?: string) =>
  JSON.stringify([computer, s]);
export const imageFailed = (s: Source, computer?: string) =>
  failed.has(scopedKey(s, computer));

/**
 * The image as a data URL; with `max`, at most that many pixels on its longer
 * side, which the desktop shrinks it to from `imageBridge` on. Older desktops
 * send it whole.
 */
export function useImage(source: Source, max?: number) {
  const remote = useRemote();
  const bridge = remote.overview?.bridge;
  const shrunk = !!max && (bridge ?? 1) >= imageBridge;
  const sourceKey = keyOf(source);
  const computer = remote.active;
  const key = scopedKey(source, computer) + (shrunk ? `@${max}` : "");
  const [result, setResult] = useState<{
    key: string;
    uri?: string;
    failed?: boolean;
  }>();
  const { call, desktop, status } = remote;
  useEffect(() => {
    const source: Source = JSON.parse(sourceKey);
    if (source.kind === "pending" || status !== "online") return;
    // Until the overview says which bridge it is, a thumbnail could come whole.
    if (max && bridge === undefined) return;
    let live = true;
    failed.delete(scopedKey(source, computer));
    void cache
      .load(key, () =>
        shrunk
          ? call("image", source, max!)
          : source.kind === "attached"
            ? desktop("projectChatImage", source.chatId, source.imageId)
            : desktop(
                "projectChatReadImage",
                source.chatId,
                source.messageId,
                source.path,
              ),
      )
      .then((uri) => {
        if (live) setResult({ key, uri });
      })
      .catch(() => {
        if (!live) return;
        failed.add(scopedKey(source, computer));
        setResult({ key, failed: true });
      });
    return () => {
      live = false;
    };
  }, [key, sourceKey, computer, status, bridge, shrunk, max, call, desktop]);
  if (source.kind === "pending") {
    const uri = outgoingImage(source.messageId, source.index);
    return { uri, failed: !uri };
  }
  return result?.key === key
    ? { uri: result.uri, failed: !!result.failed }
    : { uri: cache.get(key), failed: false };
}
