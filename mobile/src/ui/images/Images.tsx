import { useState } from "react";
import {
  ActivityIndicator,
  Dimensions,
  Image,
  PixelRatio,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { answerImagePaths } from "../../../../shared/answer-images";
import { turnImages, type ChatMessage } from "../../../../shared/projects";
import type { LightboxImage } from "./Lightbox";
import { useTheme } from "../theme";
import { keyOf, useImage, type Source } from "./useImage";

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
    /** What the agent has looked at so far, which its trace rows open among. */
    looked: turnImages(message).map(read),
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

const traceHeight = 88;
// Wider or taller than this, a picture is cropped to it rather than squeezed or stretched.
const traceRatios = [0.75, 2] as const;

/**
 * The picture a trace row's agent looked at, under the row and big enough to
 * tell what it is; tapped, it opens. Its height is held from the start, so a
 * running call, the fetch and the decode don't move the trace.
 */
export function ReadPreview({
  source,
  name,
  done,
  onOpen,
}: {
  source: Extract<Source, { kind: "read" }>;
  name: string;
  /** While the call runs there's no picture yet, only its place. */
  done: boolean;
  onOpen?: () => void;
}) {
  const t = useTheme();
  const [ratio, setRatio] = useState(4 / 3);
  const box = [
    styles.trace,
    {
      width: traceHeight * Math.min(traceRatios[1], Math.max(traceRatios[0], ratio)),
      borderColor: t.border,
      backgroundColor: t.raised,
    },
  ];
  if (!done) return <View style={box} />;
  return (
    <Pressable
      accessibilityRole="imagebutton"
      accessibilityLabel={name}
      disabled={!onOpen}
      onPress={onOpen}
      style={box}
    >
      <Picture
        source={source}
        max={pixels(traceHeight * traceRatios[1])}
        onRatio={setRatio}
      />
    </Pressable>
  );
}

/** A finished image read's row icon on the live row, which can't grow: the picture, icon-sized. */
export function ReadSwatch({ source }: { source: Source }) {
  const t = useTheme();
  return (
    <View style={[styles.swatch, { backgroundColor: t.raised }]}>
      <Picture source={source} max={pixels(traceHeight * traceRatios[1])} />
    </View>
  );
}

/** The picture filling its box, cropped to it; nothing until it loads. */
function Picture({
  source,
  max,
  onRatio,
}: {
  source: Source;
  max: number;
  onRatio?: (ratio: number) => void;
}) {
  const { uri } = useImage(source, max);
  if (!uri) return null;
  return (
    <Image
      source={{ uri }}
      style={StyleSheet.absoluteFill}
      resizeMode="cover"
      onLoad={(e) => {
        const { width, height } = e.nativeEvent.source;
        if (width && height) onRatio?.(width / height);
      }}
    />
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
  trace: {
    height: traceHeight,
    marginTop: 2,
    marginBottom: 6,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  swatch: { width: 14, height: 14, borderRadius: 3, overflow: "hidden" },
});
