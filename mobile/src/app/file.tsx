import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { Stack, useLocalSearchParams } from "expo-router";
import type { LocalFile } from "../../../shared/types";
import { useRemote } from "../remote/RemoteProvider";
import { Code, maxCodeLines } from "../ui/Code";
import { LoadFailed } from "../ui/Rows";
import { mono, type, useTheme } from "../ui/theme";

/** A file as it is on disk, highlighted; editing stays on the desktop. */
export default function FileScreen() {
  const { where, path } = useLocalSearchParams<{ where: string; path: string }>();
  const remote = useRemote();
  const t = useTheme();
  const [file, setFile] = useState<LocalFile>();
  const [error, setError] = useState<string>();
  const load = useCallback(
    () =>
      remote
        .desktop("projectFile", where, path)
        .then(setFile)
        .catch((e) => setError(e instanceof Error ? e.message : String(e))),
    [remote, where, path],
  );
  useEffect(() => {
    if (remote.status === "online" && !file) void load();
  }, [remote.status, file, load]);
  const lines = file?.contents.split("\n").length ?? 0;
  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: path.split("/").at(-1) }} />
      <Text numberOfLines={1} ellipsizeMode="head" style={[styles.path, { color: t.muted, borderColor: t.border }]}>
        {path}
        {file?.branch ? `  ·  ${file.branch}` : ""}
      </Text>
      {!file ? (
        <View style={styles.center}>
          {error ? (
            <LoadFailed error={error} onRetry={load} />
          ) : (
            <ActivityIndicator color={t.muted} />
          )}
        </View>
      ) : (
        <>
          <Code code={file.contents} path={path} />
          {lines > maxCodeLines && (
            <Text style={[styles.note, { color: t.muted, borderColor: t.border }]}>
              Showing the first {maxCodeLines} of {lines} lines.
            </Text>
          )}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  path: { fontFamily: mono, fontSize: type.tiny, paddingHorizontal: 16, paddingBottom: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  note: { fontSize: type.tiny, padding: 12, textAlign: "center", borderTopWidth: StyleSheet.hairlineWidth },
});
