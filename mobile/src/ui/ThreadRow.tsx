import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { router } from "expo-router";
import { CircleHelp } from "lucide-react-native";
import type { RemoteChatSummary } from "../../../shared/remote";
import { ProviderIcon } from "./ProviderIcon";
import { type, useTheme } from "./theme";

export function ago(at: number) {
  const minutes = Math.round((Date.now() - at) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return days === 1
    ? "yesterday"
    : days < 7
      ? `${days}d ago`
      : new Date(at).toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
        });
}

/** A thread in a list: what it's doing, where, and when it last moved. */
export function ThreadRow({
  chat,
  project,
  selected,
  onPress,
  onLongPress,
}: {
  chat: RemoteChatSummary;
  /** The project's name; left out inside the project itself. */
  project?: string;
  /** Open beside the list, on a wide screen. */
  selected?: boolean;
  onPress?: () => void;
  onLongPress?: () => void;
}) {
  const t = useTheme();
  const state = chat.waiting
    ? "Waiting for you"
    : chat.running
      ? `Working · ${ago(chat.runningSince ?? chat.updated)}`
      : ago(chat.updated);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={chat.title}
      accessibilityState={selected ? { selected } : undefined}
      onPress={onPress ?? (() => router.push(`/chat/${chat.id}`))}
      onLongPress={onLongPress}
      style={({ pressed }) => [
        styles.row,
        selected && { backgroundColor: t.selected },
        pressed && { backgroundColor: t.hover },
      ]}
    >
      <View style={styles.glyph}>
        {chat.waiting ? (
          <CircleHelp size={17} color={t.accent} />
        ) : chat.running ? (
          <ActivityIndicator size="small" color={t.muted} />
        ) : chat.provider ? (
          <ProviderIcon provider={chat.provider} size={15} color={t.muted} />
        ) : null}
      </View>
      <View style={styles.text}>
        <Text numberOfLines={1} style={[styles.title, { color: t.text }]}>
          {chat.title}
        </Text>
        <Text numberOfLines={1} style={[styles.meta, { color: t.muted }]}>
          <Text style={chat.waiting ? { color: t.accent } : undefined}>
            {state}
          </Text>
          {project ? ` · ${project}` : ""}
          {chat.branch ? ` · ${chat.branch}` : ""}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    minHeight: 60,
  },
  glyph: { width: 20, alignItems: "center" },
  text: { flex: 1, gap: 3 },
  title: { fontSize: type.body, fontWeight: "500" },
  meta: { fontSize: type.tiny },
});
