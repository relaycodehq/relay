import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Dimensions,
  Image,
  PixelRatio,
  Pressable,
  ScrollView,
  StyleSheet,
} from "react-native";
import { answerImagePaths } from "../../../shared/answer-images";
import { turnImages, type ChatMessage } from "../../../shared/projects";
import { imageBridge } from "../../../shared/remote";
import { outgoingImage } from "../remote/outbox";
import { useRemote } from "../remote/RemoteProvider";
import type { LightboxImage } from "./Lightbox";
import { useTheme } from "./theme";

export type Source =
  | { kind: "attached"; chatId: string; imageId: string }
  | { kind: "read"; chatId: string; messageId: string; path: string }
  /** Pasted into a message still on its way; the outbox holds it. */
  | { kind: "pending"; messageId: string; index: number };

// Data URLs by source and size, so scrolling back doesn't fetch them again.
const cache = new Map<string, string>();
// Ones the desktop refused, so the lightbox skips them as the desktop's does.
const failed = new Set<string>();
export const keyOf = (s: Source) => JSON.stringify(s);
export const imageFailed = (s: Source) => failed.has(keyOf(s));

/**
 * The image as a data URL; with `max`, at most that many pixels on its longer
 * side, which the desktop shrinks it to from `imageBridge` on. Older desktops
 * send it whole.
 */
export function useImage(source: Source, max?: number) {
  const remote = useRemote();
  const bridge = remote.overview?.bridge;
  const shrunk = !!max && (bridge ?? 1) >= imageBridge;
  const key = keyOf(source) + (shrunk ? `@${max}` : "");
  const [uri, setUri] = useState(() =>
    source.kind === "pending" ? outgoingImage(source.messageId, source.index) : cache.get(key),
  );
  const [error, setError] = useState(
    failed.has(keyOf(source)) || (source.kind === "pending" && !uri),
  );
  useEffect(() => {
    if (uri || error || source.kind === "pending" || remote.status !== "online") return;
    // Until the overview says which bridge it is, a thumbnail could come whole.
    if (max && bridge === undefined) return;
    const load = shrunk
      ? remote.call("image", source, max)
      : source.kind === "attached"
        ? remote.desktop("projectChatImage", source.chatId, source.imageId)
        : remote.desktop("projectChatReadImage", source.chatId, source.messageId, source.path);
    void load
      .then((data) => {
        cache.set(key, data);
        setUri(data);
      })
      .catch(() => {
        failed.add(keyOf(source));
        setError(true);
      });
  }, [key, uri, error, remote.status, bridge]);
  return { uri, failed: error };
}

const thumbSize = 88;
const answerHeight = 420;
const pixels = (points: number) => Math.round(points * PixelRatio.get());

const fileName = (path: string) => path.split("/").at(-1) || path;

/**
 * Every image of a message, in the order the lightbox steps through them:
 * pasted ones, those its answer shows (under `root`), then, once the turn
 * ends, the rest its agent read. `strip` holds the pasted and the unshown
 * read ones for the row below.
 */
export function messageImages(chatId: string, message: ChatMessage, root?: string) {
  const read = (path: string): LightboxImage => ({
    source: { kind: "read", chatId, messageId: message.id, path },
    name: fileName(path),
  });
  const pasted = (message.images ?? []).map(
    (image, index): LightboxImage => ({
      source: message.pending
        ? { kind: "pending", messageId: message.id, index }
        : { kind: "attached", chatId, imageId: image.id },
      name: image.name,
    }),
  );
  const shown = message.role === "assistant" && root ? answerImagePaths(message.body, root) : [];
  const unshown =
    message.status === "streaming"
      ? []
      : turnImages(message)
          .filter((path) => !shown.includes(path))
          .map(read);
  return {
    all: [...pasted, ...(message.status === "streaming" ? [] : shown.map(read)), ...unshown],
    strip: [...pasted, ...unshown],
  };
}

/** The row under a message: pasted images, and the ones its agent read but didn't show. */
export function MessageImages({
  images,
  onOpen,
}: {
  images: LightboxImage[];
  onOpen: (source: Source) => void;
}) {
  if (!images.length) return null;
  return (
    <ScrollView horizontal contentContainerStyle={styles.row}>
      {images.map((image) => (
        <Thumb key={keyOf(image.source)} image={image} onPress={() => onOpen(image.source)} />
      ))}
    </ScrollView>
  );
}

function Thumb({ image, onPress }: { image: LightboxImage; onPress: () => void }) {
  const t = useTheme();
  // Covers a square, so its shorter side is what has to fill it.
  const { uri } = useImage(image.source, pixels(thumbSize * 2));
  return (
    <Pressable
      accessibilityRole="imagebutton"
      accessibilityLabel={image.name}
      onPress={onPress}
      style={[styles.thumb, { borderColor: t.border, backgroundColor: t.raised }]}
    >
      {uri ? (
        <Image source={{ uri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
      ) : (
        <ActivityIndicator color={t.muted} />
      )}
    </Pressable>
  );
}

/** An image an answer embeds, full width where the text puts it; nothing until it loads, or if it can't. */
export function AnswerImage({
  source,
  alt,
  onOpen,
}: {
  source: Source;
  alt: string;
  onOpen: (source: Source) => void;
}) {
  const t = useTheme();
  const { uri } = useImage(
    source,
    pixels(Math.max(answerHeight, Dimensions.get("window").width)),
  );
  const [ratio, setRatio] = useState<number>();
  if (!uri) return null;
  // Measured out of the layout before it's drawn, so it takes its height once instead of
  // jolting the thread. Not Image.getSize: Android's refuses data URIs.
  if (!ratio)
    return (
      <Image
        source={{ uri }}
        style={styles.measure}
        onLoad={(e) => {
          const { width, height } = e.nativeEvent.source;
          if (width && height) setRatio(width / height);
        }}
      />
    );
  return (
    <Pressable
      accessibilityRole="imagebutton"
      accessibilityLabel={alt || (source.kind === "read" ? fileName(source.path) : "Image")}
      onPress={() => onOpen(source)}
      // A tall screenshot narrows instead of running screens long.
      style={[styles.answer, { borderColor: t.border, maxWidth: answerHeight * ratio }]}
    >
      <Image source={{ uri }} style={{ width: "100%", aspectRatio: ratio }} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { gap: 8 },
  thumb: {
    width: thumbSize,
    height: thumbSize,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  answer: {
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  measure: { position: "absolute", width: 1, height: 1, opacity: 0 },
});
