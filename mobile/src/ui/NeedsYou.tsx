// While you're inside one thread, another starting to wait on you (a question,
// an approval) shows up under the header and buzzes once, so a folded phone
// without the list in view doesn't miss it.
import { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import * as Haptics from "expo-haptics";
import { X } from "lucide-react-native";
import { useRemote } from "../remote/RemoteProvider";
import { openInPane } from "./panes";
import { type, useTheme } from "./theme";

const waitingColor = "#d99a2b";
/** Long enough to read and reach, short enough not to linger. */
const shownMs = 10_000;

export function NeedsYou({
  top,
  openId,
  hidden,
  pane,
}: {
  /** Below the stack's header. */
  top: number;
  /** The thread on screen, which needs no telling. */
  openId?: string;
  /** Somewhere the list already says so. */
  hidden: boolean;
  /** Beside the list: open it as the whole pane. */
  pane: boolean;
}) {
  const t = useTheme();
  const { overview, active } = useRemote();
  const waiting = useMemo(
    () =>
      (overview?.chats ?? [])
        .filter((c) => c.waiting)
        .map((c) => c.id)
        .join(","),
    [overview?.chats],
  );
  const [before, setBefore] = useState<{ computer?: string; waiting: string }>();
  const [shown, setShown] = useState<string>();
  // Compared with the last render's, not in an effect: only threads that
  // start waiting from now on count, not the ones already waiting on launch
  // or on the computer just switched to.
  if (overview && (before?.waiting !== waiting || before?.computer !== active)) {
    setBefore({ computer: active, waiting });
    if (before && before.computer === active) {
      const old = new Set(before.waiting.split(","));
      const fresh = waiting
        .split(",")
        .find((id) => id && !old.has(id) && id !== openId);
      if (fresh) setShown(fresh);
    }
  }
  useEffect(() => {
    if (!shown) return;
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    const timer = setTimeout(() => setShown(undefined), shownMs);
    return () => clearTimeout(timer);
  }, [shown]);

  const chat = overview?.chats.find((c) => c.id === shown && c.waiting);
  if (!chat || hidden || chat.id === openId) return null;
  const project = overview?.projects.find((p) => p.id === chat.projectId);
  return (
    <View style={[styles.wrap, { top: top + 8 }]} pointerEvents="box-none">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${chat.title} needs you. Open it.`}
        accessibilityLiveRegion="polite"
        onPress={() => {
          setShown(undefined);
          const href = `/chat/${chat.id}` as const;
          if (pane) openInPane(href);
          else router.push(href);
        }}
        style={({ pressed }) => [
          styles.banner,
          { backgroundColor: t.raised, borderColor: t.border },
          pressed && { backgroundColor: t.hover },
        ]}
      >
        <View style={[styles.dot, { backgroundColor: waitingColor }]} />
        <View style={styles.text}>
          <Text numberOfLines={1} style={[styles.title, { color: t.text }]}>
            {chat.title}
          </Text>
          <Text
            numberOfLines={1}
            style={[styles.meta, { color: waitingColor }]}
          >
            Needs input{project ? ` · ${project.name}` : ""}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Dismiss"
          hitSlop={10}
          onPress={() => setShown(undefined)}
        >
          <X size={16} color={t.muted} />
        </Pressable>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "absolute", left: 12, right: 12 },
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    elevation: 4,
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  text: { flex: 1, gap: 2 },
  title: { fontSize: type.body, fontWeight: "500" },
  meta: { fontSize: type.tiny },
});
