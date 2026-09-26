import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  SectionList,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Redirect, Stack, router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CircleHelp, Plus } from "lucide-react-native";
import { chatActivitySections } from "../../../shared/chat-activity";
import type { RemoteChatSummary } from "../../../shared/remote";
import { useRemote } from "../remote/RemoteProvider";
import { Button } from "../ui/Button";
import { ConnectionLine } from "../ui/ConnectionLine";
import { ProviderIcon } from "../ui/ProviderIcon";
import { type, useTheme } from "../ui/theme";

export default function Home() {
  const remote = useRemote();
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const [refreshing, setRefreshing] = useState(false);
  const overview = remote.overview;
  const projects = useMemo(
    () => new Map(overview?.projects.map((p) => [p.id, p.name])),
    [overview?.projects],
  );
  const sections = useMemo(() => {
    if (!overview) return [];
    const { active, snoozed, settled } = chatActivitySections(
      overview.chats,
      Date.now(),
    );
    return [
      { title: "Needs you", data: active.filter((c) => c.waiting) },
      { title: "Working", data: active.filter((c) => c.running && !c.waiting) },
      { title: "Recent", data: active.filter((c) => !c.running && !c.waiting) },
      { title: "Snoozed", data: snoozed },
      { title: "Done", data: settled },
    ].filter((s) => s.data.length);
  }, [overview]);

  if (!remote.ready) return null;
  if (!remote.paired) return <Redirect href="/pair" />;

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: remote.name }} />
      <ConnectionLine />
      {remote.status === "denied" ? (
        <View style={styles.empty}>
          <Text style={[styles.emptyText, { color: t.muted }]}>
            Pair this phone again from Relay's Settings → Phone on your computer.
          </Text>
          <Button
            label="Pair again"
            primary
            style={styles.grow0}
            onPress={() =>
              void remote.forget().then(() => router.replace("/pair"))
            }
          />
        </View>
      ) : !overview ? (
        <View style={styles.empty}>
          <ActivityIndicator color={t.muted} />
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(c) => c.id}
          stickySectionHeadersEnabled={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              tintColor={t.muted}
              colors={[t.accent]}
              progressBackgroundColor={t.raised}
              onRefresh={() => {
                setRefreshing(true);
                void remote
                  .refresh()
                  .catch(() => {})
                  .finally(() => setRefreshing(false));
              }}
            />
          }
          renderSectionHeader={({ section }) => (
            <Text style={[styles.section, { color: t.muted }]}>
              {section.title}
            </Text>
          )}
          renderItem={({ item }) => (
            <ThreadRow
              chat={item}
              project={projects.get(item.projectId) ?? ""}
              onLongPress={() => {
                const done = !!item.settledAt && item.settledAt >= item.updated;
                Alert.alert(item.title, undefined, [
                  {
                    text: done ? "Move back to Recent" : "Mark as done",
                    onPress: () =>
                      void remote.call("settle", item.id, !done).catch((e) =>
                        Alert.alert("Couldn't change it", String(e.message ?? e)),
                      ),
                  },
                  { text: "Cancel", style: "cancel" },
                ]);
              }}
            />
          )}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={[styles.emptyText, { color: t.muted }]}>
                No threads yet. Start one here or on your computer.
              </Text>
            </View>
          }
          contentContainerStyle={[styles.list, !sections.length && styles.grow]}
        />
      )}
      {overview && remote.status !== "denied" && (
        // Where the thumb is, not up in the header.
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="New thread"
          onPress={() => router.push("/new")}
          style={({ pressed }) => [
            styles.fab,
            { backgroundColor: t.accent, bottom: 20 + insets.bottom },
            pressed && { opacity: 0.85 },
          ]}
        >
          <Plus size={18} color={t.onAccent} strokeWidth={2.5} />
          <Text style={[styles.fabText, { color: t.onAccent }]}>New thread</Text>
        </Pressable>
      )}
    </View>
  );
}

function ThreadRow({
  chat,
  project,
  onLongPress,
}: {
  chat: RemoteChatSummary;
  project: string;
  onLongPress: () => void;
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
      onPress={() => router.push(`/chat/${chat.id}`)}
      onLongPress={onLongPress}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: t.hover }]}
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
      <View style={styles.rowText}>
        <Text numberOfLines={1} style={[styles.title, { color: t.text }]}>
          {chat.title}
        </Text>
        <Text numberOfLines={1} style={[styles.meta, { color: t.muted }]}>
          <Text style={chat.waiting ? { color: t.accent } : undefined}>{state}</Text>
          {project ? ` · ${project}` : ""}
          {chat.branch ? ` · ${chat.branch}` : ""}
        </Text>
      </View>
    </Pressable>
  );
}

function ago(at: number) {
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
      : new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  list: { paddingBottom: 110 },
  grow: { flexGrow: 1 },
  fab: {
    position: "absolute",
    right: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    height: 48,
    paddingHorizontal: 18,
    borderRadius: 16,
    elevation: 3,
  },
  fabText: { fontSize: type.body, fontWeight: "600" },
  section: {
    fontSize: type.tiny,
    fontWeight: "600",
    paddingHorizontal: 16,
    paddingTop: 18,
    paddingBottom: 6,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    minHeight: 60,
  },
  glyph: { width: 20, alignItems: "center" },
  rowText: { flex: 1, gap: 3 },
  title: { fontSize: type.body, fontWeight: "500" },
  meta: { fontSize: type.tiny },
  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
    gap: 16,
  },
  emptyText: { fontSize: type.small, textAlign: "center", lineHeight: 20 },
  grow0: { flexGrow: 0, alignSelf: "stretch" },
});
