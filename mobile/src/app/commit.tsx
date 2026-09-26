import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import { Stack, router, useLocalSearchParams } from "expo-router";
import type { CommitDetail } from "../../../shared/history";
import { useRemote } from "../remote/RemoteProvider";
import { diffHref } from "../remote/links";
import { LoadFailed, Row, SectionTitle } from "../ui/Rows";
import { mono, type, useTheme } from "../ui/theme";

const statusLabels = { A: "Added", M: "Modified", D: "Deleted", R: "Renamed", C: "Copied", T: "Type changed" };

/** One commit: its message, and the files it changed against its first parent. */
export default function CommitScreen() {
  const { where, sha } = useLocalSearchParams<{ where: string; sha: string }>();
  const remote = useRemote();
  const t = useTheme();
  const [commit, setCommit] = useState<CommitDetail>();
  const [error, setError] = useState<string>();
  const load = useCallback(
    () =>
      remote
        .desktop("projectCommit", where, sha)
        .then(setCommit)
        .catch((e) => setError(e instanceof Error ? e.message : String(e))),
    [remote, where, sha],
  );
  useEffect(() => {
    if (remote.status === "online" && !commit) void load();
  }, [remote.status, commit, load]);
  if (!commit)
    return (
      <View style={styles.center}>
        <Stack.Screen options={{ title: sha.slice(0, 7) }} />
        {error ? (
          <LoadFailed error={error} onRetry={load} />
        ) : (
          <ActivityIndicator color={t.muted} />
        )}
      </View>
    );
  return (
    <ScrollView contentContainerStyle={styles.list}>
      <Stack.Screen options={{ title: sha.slice(0, 7) }} />
      <View style={styles.head}>
        <Text selectable style={[styles.subject, { color: t.text }]}>{commit.subject}</Text>
        {!!commit.body.trim() && (
          <Text selectable style={[styles.body, { color: t.text }]}>{commit.body.trim()}</Text>
        )}
        <Text style={[styles.meta, { color: t.muted }]}>
          {commit.author} · {new Date(commit.time * 1000).toLocaleString()}
        </Text>
        <Text selectable style={[styles.meta, { color: t.faint, fontFamily: mono }]}>{commit.sha}</Text>
      </View>
      <SectionTitle>{`${commit.files.length} ${commit.files.length === 1 ? "file" : "files"}`}</SectionTitle>
      {commit.files.map((f) => (
        <Row
          key={f.path}
          title={f.path}
          subtitle={
            f.binary
              ? `${statusLabels[f.status]} · binary`
              : `${statusLabels[f.status]} · +${f.additions} −${f.deletions}${f.previousPath ? ` · from ${f.previousPath}` : ""}`
          }
          onPress={() => router.push(diffHref({ kind: "commit", where, sha, path: f.path }))}
        />
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  list: { paddingBottom: 40 },
  head: { padding: 16, gap: 8 },
  subject: { fontSize: type.title, fontWeight: "600", lineHeight: 23 },
  body: { fontSize: type.small, lineHeight: 20 },
  meta: { fontSize: type.tiny },
});
