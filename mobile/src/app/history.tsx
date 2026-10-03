import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from "react-native";
import { Stack, router, useLocalSearchParams } from "expo-router";
import type { CommitLog } from "../../../shared/history";
import { useRemote } from "../remote/RemoteProvider";
import { Button } from "../ui/Button";
import { LoadFailed, Row } from "../ui/Rows";
import { ago } from "../ui/ThreadRow";
import { mono, useTheme } from "../ui/theme";

const page = 100;

/** The checked-out branch's commits, newest first. */
export default function HistoryScreen() {
  const { where } = useLocalSearchParams<{ where: string }>();
  const remote = useRemote();
  const t = useTheme();
  const [log, setLog] = useState<CommitLog>();
  const [limit, setLimit] = useState(page);
  const [error, setError] = useState<string>();
  const load = useCallback(async () => {
    if (remote.status !== "online") return;
    try {
      setLog(await remote.desktop("projectHistory", where, "head", limit));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [remote, where, limit]);
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: "History" }} />
      {!log ? (
        <View style={styles.center}>
          {error ? (
            <LoadFailed error={error} onRetry={load} />
          ) : (
            <ActivityIndicator color={t.muted} />
          )}
        </View>
      ) : (
        <FlatList
          data={log.commits}
          keyExtractor={(c) => c.sha}
          renderItem={({ item }) => (
            <Row
              title={item.subject}
              subtitle={
                <>
                  <Text style={{ fontFamily: mono }}>{item.sha.slice(0, 7)}</Text>
                  {` · ${item.author} · ${ago(item.time * 1000)}`}
                  {item.refs.length ? ` · ${item.refs.join(", ")}` : ""}
                </>
              }
              onPress={() => router.push({ pathname: "/commit", params: { where, sha: item.sha } })}
            />
          )}
          ListFooterComponent={
            log.more ? (
              <View style={styles.more}>
                <Button label="Older commits" onPress={() => setLimit((n) => n + page)} />
              </View>
            ) : null
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  more: { padding: 16 },
});
