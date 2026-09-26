import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { X } from "lucide-react-native";
import type { ChatMessage } from "../../../shared/projects";
import { useRemote } from "../remote/RemoteProvider";
import { useTheme } from "./theme";

type Source =
  | { kind: "attached"; chatId: string; imageId: string }
  | { kind: "read"; chatId: string; messageId: string; path: string };

// Data URLs by source, so scrolling back doesn't fetch them again.
const cache = new Map<string, string>();
const keyOf = (s: Source) => JSON.stringify(s);

function useImage(source: Source) {
  const remote = useRemote();
  const key = keyOf(source);
  const [uri, setUri] = useState(cache.get(key));
  useEffect(() => {
    if (uri || remote.status !== "online") return;
    const load =
      source.kind === "attached"
        ? remote.desktop("projectChatImage", source.chatId, source.imageId)
        : remote.desktop("projectChatReadImage", source.chatId, source.messageId, source.path);
    void load
      .then((data) => {
        cache.set(key, data);
        setUri(data);
      })
      .catch(() => {});
  }, [key, uri, remote.status]);
  return uri;
}

const isImagePath = (path: string) => /\.(?:png|jpe?g|gif|webp)$/i.test(path);

/** Images the agent looked at during a turn, by path (shared/projects' turnImages). */
function turnImages(message: ChatMessage): string[] {
  const calls = message.trace
    ? message.trace.flatMap((e) => (e.kind === "activity" ? [e.activity] : []))
    : (message.activity ?? []);
  return [
    ...new Set(
      calls
        .filter((a) => a.kind === "read" && a.status === "complete" && isImagePath(a.label))
        .map((a) => a.label),
    ),
  ];
}

/** A message's pasted images, and once a turn ends, the images its agent read. */
export function MessageImages({ chatId, message }: { chatId: string; message: ChatMessage }) {
  const [open, setOpen] = useState<Source>();
  const sources: Source[] = [
    ...(message.images ?? []).map(
      (image): Source => ({ kind: "attached", chatId, imageId: image.id }),
    ),
    ...(message.status === "streaming"
      ? []
      : turnImages(message).map(
          (path): Source => ({ kind: "read", chatId, messageId: message.id, path }),
        )),
  ];
  if (!sources.length) return null;
  return (
    <>
      <ScrollView horizontal contentContainerStyle={styles.row}>
        {sources.map((s) => (
          <Thumb key={keyOf(s)} source={s} onPress={() => setOpen(s)} />
        ))}
      </ScrollView>
      {open && <Viewer source={open} onClose={() => setOpen(undefined)} />}
    </>
  );
}

function Thumb({ source, onPress }: { source: Source; onPress: () => void }) {
  const t = useTheme();
  const uri = useImage(source);
  return (
    <Pressable
      accessibilityRole="imagebutton"
      accessibilityLabel={source.kind === "read" ? source.path : "Attached image"}
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

function Viewer({ source, onClose }: { source: Source; onClose: () => void }) {
  const uri = useImage(source);
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.viewer}>
        {uri ? (
          <Image source={{ uri }} style={styles.full} resizeMode="contain" />
        ) : (
          <ActivityIndicator color="#fff" />
        )}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          onPress={onClose}
          hitSlop={12}
          style={styles.close}
        >
          <X size={22} color="#fff" />
        </Pressable>
      </View>
    </Modal>
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
  viewer: { flex: 1, backgroundColor: "rgba(0,0,0,0.92)", alignItems: "center", justifyContent: "center" },
  full: { width: "100%", height: "100%" },
  close: { position: "absolute", top: 56, right: 20 },
});
