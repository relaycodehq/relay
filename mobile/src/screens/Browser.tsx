import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { router, type Href } from "expo-router";
import { Plus, Search, X } from "lucide-react-native";
import type { RemoteChatSummary, RemoteProject } from "../../../shared/remote";
import { useRemote } from "../remote/RemoteProvider";
import { useProjectIconSync } from "../remote/project-icons";
import { ActivityList } from "../ui/ActivityList";
import { Button } from "../ui/Button";
import { ConnectionLine } from "../ui/ConnectionLine";
import { ComputerUpdateBanner } from "../ui/ComputerUpdate";
import { UpdateBanner } from "../ui/UpdateBanner";
import { ProjectIcon } from "../ui/ProjectIcon";
import { Row, Segmented, rowStyles } from "../ui/Rows";
import { ThreadRow, ago } from "../ui/ThreadRow";
import { openInPane } from "../ui/panes";
import { type, useTheme } from "../ui/theme";

type Tab = "activity" | "projects";

/** Scratchpad threads shown before "Show more", as on the desktop. */
const scratchPage = 5;

/**
 * Activity and Projects: the phone's home screen, or the sidebar beside the
 * open thread on a wide screen (`pane`), where `selected` is what's open.
 */
export function Browser({
  pane,
  selected,
}: {
  pane?: boolean;
  selected?: string;
}) {
  const remote = useRemote();
  const t = useTheme();
  const [tab, setTab] = useState<Tab>("activity");
  const [query, setQuery] = useState("");
  const [allScratch, setAllScratch] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const overview = remote.overview;
  const names = useMemo(
    () => new Map(overview?.projects.map((p) => [p.id, p.name])),
    [overview?.projects],
  );
  // Every Scratchpad chat has a folder of its own; together they're one list.
  const scratch = useMemo(() => {
    const ids = new Set(
      overview?.projects.filter((p) => p.scratch).map((p) => p.id),
    );
    return (overview?.chats ?? [])
      .filter((c) => ids.has(c.projectId))
      .sort((a, b) => b.updated - a.updated);
  }, [overview]);
  // The desktop's sidebar: projects under their virtual folders.
  const folders = useMemo(() => {
    const groups = new Map<string, RemoteProject[]>();
    for (const p of overview?.projects ?? []) {
      if (p.scratch) continue;
      const key = p.folder || "Projects";
      groups.set(key, [...(groups.get(key) ?? []), p]);
    }
    return [...groups]
      .sort(([a], [b]) =>
        a === "Projects" ? -1 : b === "Projects" ? 1 : a.localeCompare(b),
      )
      .map(([title, data]) => ({ title, data }));
  }, [overview]);
  const needle = query.trim().toLowerCase();
  const results = useMemo(
    () =>
      needle
        ? (overview?.chats ?? []).filter((c) =>
            `${c.title} ${names.get(c.projectId) ?? ""}`
              .toLowerCase()
              .includes(needle),
          )
        : [],
    [needle, overview?.chats, names],
  );

  useProjectIconSync(
    remote.active,
    remote.call,
    remote.status === "online",
    useMemo(
      () => overview?.projects.map((p) => p.id) ?? [],
      [overview?.projects],
    ),
  );
  const open = (href: Href) => (pane ? openInPane(href) : router.push(href));
  const openChat = (c: RemoteChatSummary) => open(`/chat/${c.id}`);
  const refresh = (
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
  );
  const triage: Parameters<typeof ActivityList>[0]["onTriage"] = (
    chat,
    action,
  ) =>
    remote
      .desktop("triageProjectChat", chat.id, action)
      .then((after) => {
        void remote.refresh().catch(() => {});
        return after;
      })
      .catch((e) => {
        Alert.alert("Couldn't change it", String(e?.message ?? e));
        return undefined;
      });

  const projectsView = overview && (
    <ScrollView refreshControl={refresh} contentContainerStyle={styles.list}>
      <View style={styles.sectionRow}>
        <Text style={[styles.section, { color: t.muted }]}>Scratchpad</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="New Scratchpad chat"
          hitSlop={10}
          onPress={() => open("/new?scratch=1")}
          style={styles.sectionAction}
        >
          <Plus size={17} color={t.muted} />
        </Pressable>
      </View>
      {(allScratch ? scratch : scratch.slice(0, scratchPage)).map((c) => (
        <ThreadRow
          key={c.id}
          chat={c}
          selected={c.id === selected}
          onPress={() => openChat(c)}
        />
      ))}
      {!scratch.length && (
        <Row
          title="Ask anything"
          subtitle="A chat of its own, outside your projects"
          chevron={false}
          onPress={() => open("/new?scratch=1")}
        />
      )}
      {scratch.length > scratchPage && (
        <Pressable
          accessibilityRole="button"
          onPress={() => setAllScratch((all) => !all)}
          style={styles.more}
        >
          <Text style={[styles.moreText, { color: t.muted }]}>
            {allScratch
              ? "Show less"
              : `Show ${scratch.length - scratchPage} more`}
          </Text>
        </Pressable>
      )}
      {folders.map((folder) => (
        <View key={folder.title}>
          <Text style={[styles.section, { color: t.muted }]}>
            {folder.title}
          </Text>
          {folder.data.map((p) => {
            const chats = overview.chats.filter((c) => c.projectId === p.id);
            const busy = chats.filter((c) => c.running || c.waiting).length;
            return (
              <Row
                key={p.id}
                icon={<ProjectIcon project={p} />}
                title={p.name}
                subtitle={
                  chats.length
                    ? `${busy ? `${busy} working · ` : ""}${chats.length} ${chats.length === 1 ? "thread" : "threads"} · ${ago(chats[0]!.updated)}`
                    : "No threads yet"
                }
                selected={p.id === selected}
                onPress={() => open(`/project/${p.id}`)}
              />
            );
          })}
        </View>
      ))}
    </ScrollView>
  );

  return (
    <View style={styles.screen}>
      <ConnectionLine />
      <ComputerUpdateBanner />
      <UpdateBanner />
      {remote.status === "denied" ? (
        <View style={styles.empty}>
          <Text style={[rowStyles.empty, { color: t.muted }]}>
            Pair this phone again from Relay’s Settings → Phone on your
            computer.
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
        <>
          <View
            style={[
              styles.search,
              { backgroundColor: t.raised, borderColor: t.border },
            ]}
          >
            <Search size={16} color={t.muted} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search"
              placeholderTextColor={t.muted}
              accessibilityLabel="Search threads"
              autoCorrect={false}
              returnKeyType="search"
              style={[styles.searchInput, { color: t.text }]}
            />
            {!!query && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Clear search"
                hitSlop={10}
                onPress={() => setQuery("")}
              >
                <X size={16} color={t.muted} />
              </Pressable>
            )}
          </View>
          {needle ? (
            <FlatList
              data={results}
              keyExtractor={(c) => c.id}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              ListHeaderComponent={
                <View style={styles.sectionRow}>
                  <Text style={[styles.section, { color: t.muted }]}>
                    Results
                  </Text>
                  <Text style={[styles.count, { color: t.muted }]}>
                    {results.length}
                  </Text>
                </View>
              }
              renderItem={({ item }) => (
                <ThreadRow
                  chat={item}
                  project={names.get(item.projectId)}
                  selected={item.id === selected}
                  onPress={() => openChat(item)}
                />
              )}
              ListEmptyComponent={
                <Text style={[rowStyles.empty, { color: t.muted }]}>
                  No thread or project matches “{query.trim()}”.
                </Text>
              }
              contentContainerStyle={styles.list}
            />
          ) : (
            <>
              <View style={styles.tabs}>
                <Segmented
                  value={tab}
                  onChange={setTab}
                  options={[
                    { value: "activity", label: "Activity" },
                    { value: "projects", label: "Projects" },
                  ]}
                />
              </View>
              {tab === "activity" ? (
                <ActivityList
                  chats={overview.chats}
                  projects={overview.projects}
                  selected={selected}
                  onOpen={openChat}
                  onTriage={triage}
                  refreshControl={refresh}
                  bottom={styles.list.paddingBottom}
                />
              ) : (
                projectsView
              )}
            </>
          )}
        </>
      )}
      {overview && remote.status !== "denied" && (
        // Where the thumb is, not up in the header.
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="New thread"
          onPress={() => open("/new")}
          style={({ pressed }) => [
            styles.fab,
            { backgroundColor: t.accent },
            pressed && { opacity: 0.85 },
          ]}
        >
          <Plus size={18} color={t.onAccent} strokeWidth={2.5} />
          <Text style={[styles.fabText, { color: t.onAccent }]}>
            New thread
          </Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  search: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: 16,
    marginTop: 4,
    marginBottom: 6,
    paddingHorizontal: 12,
    height: 40,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  searchInput: { flex: 1, fontSize: type.body, paddingVertical: 0 },
  tabs: { paddingHorizontal: 16, paddingTop: 2, paddingBottom: 4 },
  list: { paddingBottom: 110 },
  sectionRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingRight: 12,
  },
  section: {
    fontSize: type.tiny,
    fontWeight: "600",
    paddingHorizontal: 16,
    paddingTop: 18,
    paddingBottom: 6,
  },
  sectionAction: { paddingTop: 12, paddingHorizontal: 4 },
  count: { fontSize: type.tiny, paddingTop: 18, paddingBottom: 6 },
  more: { paddingHorizontal: 16, paddingVertical: 12 },
  moreText: { fontSize: type.small },
  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
    gap: 16,
  },
  grow0: { flexGrow: 0, alignSelf: "stretch" },
  fab: {
    position: "absolute",
    right: 16,
    bottom: 20,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    height: 48,
    paddingHorizontal: 18,
    borderRadius: 16,
    elevation: 3,
  },
  fabText: { fontSize: type.body, fontWeight: "600" },
});
