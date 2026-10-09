// The threads a lead's agent started (the desktop's StartedChip, in
// src/features/agent-turn/StartedThreads.tsx), for a phone: listed in the turn
// that started them, and over the composer while any still works or asks.
import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { Check, ChevronDown, ChevronRight, MessagesSquare } from "lucide-react-native";
import type { ChatMessage } from "../../../shared/projects";
import type { RemoteChatSummary } from "../../../shared/remote";
import { plural } from "../../../shared/activity-labels";
import {
  familyLive,
  startGroups,
  startedNow,
  startedOf,
} from "../../../shared/started-threads";
import { useRemote } from "../remote/RemoteProvider";
import { useStartedPeeks, type Peek } from "../remote/started-peeks";
import { type, useTheme, waitingColor } from "./theme";

/** How many of a turn's threads show before "N more". */
const firstShown = 4;

export const openThread = (id: string) => router.push(`/chat/${id}`);

/** Still, like a subagent's: a dot while it works, amber when it asks, a check once done. */
export function StartedMark({
  waiting,
  running,
}: {
  waiting?: boolean;
  running?: boolean;
}) {
  const t = useTheme();
  return (
    <View
      accessibilityLabel={waiting ? "Needs you" : running ? "Working" : "Done"}
      style={styles.markBox}
    >
      {waiting || running ? (
        <View style={[styles.dot, { backgroundColor: waiting ? waitingColor : t.accent }]} />
      ) : (
        <Check size={14} color={t.additionText} />
      )}
    </View>
  );
}

/** The family's mark: amber if any asks, a dot if any works, else a check. */
export const FamilyMark = ({ started }: { started: readonly RemoteChatSummary[] }) => (
  <StartedMark
    waiting={started.some((c) => c.waiting)}
    running={started.some((c) => c.running)}
  />
);

export function StartedRow({
  chat,
  peek,
  onPress,
}: {
  chat: RemoteChatSummary;
  peek: Peek;
  onPress: () => void;
}) {
  const t = useTheme();
  const now = startedNow(chat, peek);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityHint="Opens the thread"
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: t.hover }]}
    >
      <StartedMark waiting={chat.waiting} running={chat.running} />
      <View style={styles.rowText}>
        <Text numberOfLines={1} style={[styles.title, { color: t.text }]}>
          {chat.title}
        </Text>
        <Text
          numberOfLines={1}
          style={[styles.now, { color: now.tone === "asks" ? waitingColor : t.muted }]}
        >
          {now.text}
        </Text>
      </View>
      <ChevronRight size={15} color={t.faint} />
    </Pressable>
  );
}

/** Under a turn that called start_threads: the threads each call started, live. */
export function StartedInTurn({ chatId, message }: { chatId: string; message: ChatMessage }) {
  const chats = useRemote().overview?.chats;
  const family = useMemo(() => startedOf(chatId, chats ?? []), [chatId, chats]);
  const groups = startGroups(message, family);
  const peek = useStartedPeeks(groups.flatMap((g) => g.threads));
  return groups.map((g) => <StartGroupRows key={g.id} {...g} peek={peek} />);
}

function StartGroupRows({
  count,
  threads,
  peek,
}: {
  count: number;
  threads: RemoteChatSummary[];
  peek: (id: string) => Peek;
}) {
  const t = useTheme();
  const [all, setAll] = useState(false);
  const shown = all || threads.length <= firstShown + 1 ? threads : threads.slice(0, firstShown);
  return (
    <View style={styles.group}>
      <View style={styles.head}>
        <MessagesSquare size={14} color={t.muted} style={styles.icon} />
        <Text style={[styles.headText, { color: t.muted }]}>
          Started {plural(count, "thread")}
        </Text>
      </View>
      <View style={[styles.rule, { borderColor: t.border }]}>
        {shown.map((c) => (
          <StartedRow key={c.id} chat={c} peek={peek(c.id)} onPress={() => openThread(c.id)} />
        ))}
        {shown.length < threads.length && (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: false }}
            onPress={() => setAll(true)}
            style={({ pressed }) => [styles.more, pressed && { backgroundColor: t.hover }]}
          >
            <View style={styles.markBox}>
              <ChevronDown size={14} color={t.muted} />
            </View>
            <Text style={[styles.headText, { color: t.muted }]}>
              {threads.length - shown.length} more
            </Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

/** The started threads in the composer's sheet. */
export function StartedList({
  started,
  onOpen,
}: {
  started: RemoteChatSummary[];
  onOpen: (id: string) => void;
}) {
  const peek = useStartedPeeks(started);
  return started.map((c) => (
    <View key={c.id} style={styles.sheetRow}>
      <StartedRow chat={c} peek={peek(c.id)} onPress={() => onOpen(c.id)} />
    </View>
  ));
}

/**
 * The lead's started threads and whether the composer's strip shows them:
 * while any works or asks. Read back in the thread, the strip stays as it
 * was until the reader is at the bottom again, so the answers don't move
 * under them as it comes or goes.
 */
export function useStartedSlot(lead: string, pinned: boolean) {
  const chats = useRemote().overview?.chats;
  const family = useMemo(() => startedOf(lead, chats ?? []), [lead, chats]);
  const live = familyLive(family);
  const [shown, setShown] = useState(live);
  if (pinned && shown !== live) setShown(live);
  return { family, shown: shown && family.length > 0 };
}

const styles = StyleSheet.create({
  group: { marginTop: 2, marginBottom: 8 },
  head: { flexDirection: "row", alignItems: "center", gap: 7, minHeight: 26 },
  icon: { opacity: 0.75 },
  headText: { fontSize: 13 },
  rule: { marginLeft: 6, paddingLeft: 8, borderLeftWidth: StyleSheet.hairlineWidth * 2 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minHeight: 46,
    paddingVertical: 5,
    paddingHorizontal: 4,
    borderRadius: 8,
  },
  sheetRow: { paddingHorizontal: 16 },
  rowText: { flex: 1, gap: 1 },
  title: { fontSize: type.body - 1, fontWeight: "600" },
  now: { fontSize: type.small },
  more: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minHeight: 36,
    paddingHorizontal: 4,
    borderRadius: 8,
  },
  markBox: { width: 16, alignItems: "center", justifyContent: "center" },
  dot: { width: 7, height: 7, borderRadius: 3.5 },
});
