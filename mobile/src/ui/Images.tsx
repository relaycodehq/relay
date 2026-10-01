import { useEffect, useState } from "react";
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet } from "react-native";
import { answerImagePaths } from "../../../shared/answer-images";
import type { ChatMessage } from "../../../shared/projects";
import { turnImages } from "../../../shared/projects/messages";
import { useRemote } from "../remote/RemoteProvider";
import type { LightboxImage } from "./Lightbox";
import { useTheme } from "./theme";

export type Source =
  | { kind: "attached"; chatId: string; imageId: string }
  | { kind: "read"; chatId: string; messageId: string; path: string };

// Data URLs by source, so scrolling back doesn't fetch them again.
const cache = new Map<string, string>();
// Ones the desktop refused, so the lightbox skips them as the desktop's does.
const failed = new Set<string>();
export const keyOf = (s: Source) => JSON.stringify(s);
export const imageFailed = (s: Source) => failed.has(keyOf(s));

export function useImage(source: Source) {
  const remote = useRemote();
  const key = keyOf(source);
  const [uri, setUri] = useState(cache.get(key));
  const [error, setError] = useState(failed.has(key));
  useEffect(() => {
    if (uri || error || remote.status !== "online") return;
    const load =
      source.kind === "attached"
        ? remote.desktop("projectChatImage", source.chatId, source.imageId)
        : remote.desktop("projectChatReadImage", source.chatId, source.messageId, source.path);
    void load
      .then((data) => {
        cache.set(key, data);
        setUri(data);
      })
      .catch(() => {
        failed.add(key);
        setError(true);
      });
  }, [key, uri, error, remote.status]);
  return { uri, failed: error };
}

const fileName = (path: string) => path.split("/").at(-1) || path;

/**
 * Every image of a message, in the order the lightbox steps through them:
 * pasted ones, those its answer shows (under `root`), then, once the turn
 * ends, the rest its agent read, which `strip` holds for the row below.
 */
export function messageImages(chatId: string, message: ChatMessage, root?: string) {
  const read = (path: string): LightboxImage => ({
    source: { kind: "read", chatId, messageId: message.id, path },
    name: fileName(path),
  });
  const shown = message.role === "assistant" && root ? answerImagePaths(message.body, root) : [];
  const strip =
    message.status === "streaming"
      ? []
      : turnImages(message)
          .filter((path) => !shown.includes(path))
          .map(read);
  return {
    all: [
      ...(message.images ?? []).map(
        (image): LightboxImage => ({
          source: { kind: "attached", chatId, imageId: image.id },
          name: image.name,
        }),
      ),
      ...(message.status === "streaming" ? [] : shown.map(read)),
      ...strip,
    ],
    strip,
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
  const { uri } = useImage(image.source);
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
  const { uri } = useImage(source);
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
      style={[styles.answer, { borderColor: t.border, maxWidth: 420 * ratio }]}
    >
      <Image source={{ uri }} style={{ width: "100%", aspectRatio: ratio }} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { gap: 8 },
  thumb: {
    width: 88,
    height: 88,
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
