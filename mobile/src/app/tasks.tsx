import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, View } from "react-native";
import { Stack, useLocalSearchParams } from "expo-router";
import type { ProjectTask } from "../../../shared/tasks";
import { useRemote } from "../remote/RemoteProvider";
import { ConnectionLine } from "../ui/ConnectionLine";
import { rowStyles } from "../ui/Rows";
import { Action } from "../ui/ThreadExtras";
import { ago } from "../ui/ThreadRow";
import { useForeground } from "../ui/motion";
import { mono, type, useTheme } from "../ui/theme";

const origins: Record<ProjectTask["origin"], string> = {
  relay: "Started by an agent in Relay",
  terminal: "A Relay terminal",
  external: "A Claude or Codex CLI outside Relay",
  detached: "Running on its own",
};

/** Dev servers and processes the project's agents left running; stop or restart them. */
export default function TasksScreen() {
  const { project } = useLocalSearchParams<{ project: string }>();
  const remote = useRemote();
  const t = useTheme();
  const foreground = useForeground();
  const [tasks, setTasks] = useState<ProjectTask[]>();
  const [error, setError] = useState<string>();
  const load = useCallback(async () => {
    if (remote.status !== "online") return;
    try {
      setTasks(await remote.desktop("projectTasks", project));
      setError(undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [remote, project]);
  // Processes come and go on their own; look again every few seconds while open.
  useEffect(() => {
    if (!foreground) return;
    void load();
    const timer = setInterval(() => void load(), 3000);
    return () => clearInterval(timer);
  }, [load, foreground]);
  const run = (what: string, job: Promise<void>) =>
    job.then(load).catch((e) => Alert.alert(what, e instanceof Error ? e.message : String(e)));
  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: "Tasks" }} />
      <ConnectionLine />
      {!tasks ? (
        <View style={styles.center}>
          {error ? (
            <Text style={[rowStyles.empty, { color: t.muted }]}>{error}</Text>
          ) : (
            <ActivityIndicator color={t.muted} />
          )}
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.list}>
          {!tasks.length && (
            <Text style={[rowStyles.empty, { color: t.muted }]}>Nothing is running in this project.</Text>
          )}
          {tasks.map((task) => (
            <View key={task.id} style={[styles.task, { borderColor: t.border }]}>
              <Text style={[styles.title, { color: t.text }]}>{task.title}</Text>
              <Text numberOfLines={3} selectable style={[styles.command, { color: t.muted }]}>
                {task.command}
              </Text>
              <Text style={[styles.meta, { color: t.muted }]}>
                {[
                  origins[task.origin],
                  task.worktree ? "in a worktree" : "",
                  task.ports.length ? `port ${task.ports.join(", ")}` : "",
                  `started ${ago(task.started)}`,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </Text>
              <View style={styles.actions}>
                <Action
                  label="Restart"
                  busyLabel="Restarting…"
                  onPress={() => run("Couldn't restart it", remote.desktop("restartProjectTask", project, task.id))}
                />
                <Action
                  label="Stop"
                  busyLabel="Stopping…"
                  onPress={() =>
                    new Promise<void>((resolve) =>
                      Alert.alert(`Stop ${task.title}?`, task.command, [
                        { text: "Cancel", style: "cancel", onPress: () => resolve() },
                        {
                          text: "Stop",
                          style: "destructive",
                          onPress: () =>
                            void run("Couldn't stop it", remote.desktop("stopProjectTask", project, task.id)).finally(resolve),
                        },
                      ]),
                    )
                  }
                />
              </View>
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  list: { padding: 16, gap: 12 },
  task: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, padding: 12, gap: 6 },
  title: { fontSize: type.body, fontWeight: "600" },
  command: { fontFamily: mono, fontSize: 12, lineHeight: 17 },
  meta: { fontSize: type.tiny, lineHeight: 17 },
  actions: { flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 4 },
});
