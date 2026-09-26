import { useCallback, useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { Stack, router, useFocusEffect, useLocalSearchParams } from "expo-router";
import {
  FileCode,
  GitBranch,
  GitCommitHorizontal,
  GitCompare,
  Plus,
  SquareTerminal,
} from "lucide-react-native";
import type { ProjectTask } from "../../../../shared/tasks";
import type { WorkingTree } from "../../../../shared/working-tree";
import { useRemote } from "../../remote/RemoteProvider";
import { ConnectionLine } from "../../ui/ConnectionLine";
import { Row, SectionTitle, rowStyles } from "../../ui/Rows";
import { ThreadRow } from "../../ui/ThreadRow";
import { useTheme } from "../../ui/theme";

/** A project: its checkout at a glance, its panes, and every thread in it. */
export default function ProjectScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const remote = useRemote();
  const t = useTheme();
  const project = remote.overview?.projects.find((p) => p.id === id);
  const chats = remote.overview?.chats.filter((c) => c.projectId === id) ?? [];
  const [tree, setTree] = useState<WorkingTree | null>();
  const [tasks, setTasks] = useState<ProjectTask[]>();
  const [refreshing, setRefreshing] = useState(false);
  const git = !!project && !project.plain;
  const load = useCallback(async () => {
    if (remote.status !== "online") return;
    const [working, running] = await Promise.all([
      git ? remote.desktop("projectWorkingTree", id).catch(() => null) : null,
      remote.desktop("projectTasks", id).catch(() => undefined),
    ]);
    setTree(working);
    setTasks(running);
  }, [remote, id, git]);
  // Fresh each time the screen comes back, e.g. after a commit.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );
  const changed = tree?.changes.length ?? 0;
  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: project?.name ?? "Project" }} />
      <ConnectionLine />
      <ScrollView
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            tintColor={t.muted}
            colors={[t.accent]}
            onRefresh={() => {
              setRefreshing(true);
              void Promise.all([load(), remote.refresh()]).finally(() => setRefreshing(false));
            }}
          />
        }
      >
        <Row
          icon={<Plus size={18} color={t.accent} />}
          title="New thread"
          onPress={() => router.push({ pathname: "/new", params: { project: id } })}
        />
        {git && (
          <>
            <Row
              icon={<GitCompare size={17} color={t.muted} />}
              title="Changes"
              subtitle={
                tree
                  ? [
                      changed ? `${changed} changed` : "No changes",
                      tree.lines.additions || tree.lines.deletions
                        ? `+${tree.lines.additions} −${tree.lines.deletions}`
                        : "",
                      tree.ahead ? `${tree.ahead} to push` : "",
                      tree.behind ? `${tree.behind} to pull` : "",
                    ]
                      .filter(Boolean)
                      .join(" · ")
                  : undefined
              }
              onPress={() => router.push({ pathname: "/changes", params: { where: id } })}
            />
            <Row
              icon={<GitBranch size={17} color={t.muted} />}
              title={tree?.branch || "Branch"}
              subtitle={tree?.operation ? `${tree.operation} in progress` : "Switch or create a branch"}
              onPress={() => router.push({ pathname: "/branches", params: { project: id } })}
            />
          </>
        )}
        <Row
          icon={<FileCode size={17} color={t.muted} />}
          title="Files"
          onPress={() => router.push({ pathname: "/files", params: { where: id } })}
        />
        {git && (
          <Row
            icon={<GitCommitHorizontal size={17} color={t.muted} />}
            title="History"
            onPress={() => router.push({ pathname: "/history", params: { where: id } })}
          />
        )}
        <Row
          icon={<SquareTerminal size={17} color={t.muted} />}
          title="Tasks"
          subtitle={
            tasks === undefined
              ? undefined
              : tasks.length
                ? `${tasks.length} running`
                : "Nothing running"
          }
          onPress={() => router.push({ pathname: "/tasks", params: { project: id } })}
        />
        <SectionTitle>Threads</SectionTitle>
        {chats.length ? (
          chats.map((c) => <ThreadRow key={c.id} chat={c} />)
        ) : (
          <Text style={[rowStyles.empty, { color: t.muted }]}>No threads in this project yet.</Text>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  list: { paddingBottom: 40 },
});
