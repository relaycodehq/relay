import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, StyleSheet, Text, TextInput, View } from "react-native";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { FileText, Folder } from "lucide-react-native";
import { useRemote } from "../remote/RemoteProvider";
import { ConnectionLine } from "../ui/ConnectionLine";
import { LoadFailed, Row, rowStyles } from "../ui/Rows";
import { type, useTheme } from "../ui/theme";

/** The project's files, folder by folder, or all of them filtered by a search. Read-only on a phone. */
export default function FilesScreen() {
  const { where, dir = "" } = useLocalSearchParams<{ where: string; dir?: string }>();
  const remote = useRemote();
  const t = useTheme();
  const [files, setFiles] = useState<string[]>();
  const [error, setError] = useState<string>();
  const [query, setQuery] = useState("");
  const load = useCallback(async () => {
    if (remote.status !== "online") return;
    try {
      setFiles(await remote.desktop("projectFiles", where));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [remote, where]);
  useEffect(() => {
    void load();
  }, [load]);
  const entries = useMemo(() => {
    if (!files) return [];
    const q = query.trim().toLowerCase();
    if (q)
      return files
        .filter((f) => f.toLowerCase().includes(q))
        .slice(0, 300)
        .map((path) => ({ path, folder: false }));
    // This folder's own files and the folders directly under it.
    const prefix = dir ? `${dir}/` : "";
    const folders = new Set<string>();
    const here: string[] = [];
    for (const f of files) {
      if (!f.startsWith(prefix)) continue;
      const rest = f.slice(prefix.length);
      const slash = rest.indexOf("/");
      if (slash >= 0) folders.add(prefix + rest.slice(0, slash));
      else here.push(f);
    }
    return [
      ...[...folders].sort().map((path) => ({ path, folder: true })),
      ...here.sort().map((path) => ({ path, folder: false })),
    ];
  }, [files, dir, query]);
  const name = (path: string) => path.slice(path.lastIndexOf("/") + 1);
  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: dir ? name(dir) : "Files" }} />
      <ConnectionLine />
      <TextInput
        accessibilityLabel="Search files"
        placeholder={dir ? `Search in ${name(dir)}…` : "Search files…"}
        placeholderTextColor={t.faint}
        autoCapitalize="none"
        autoCorrect={false}
        value={query}
        onChangeText={setQuery}
        style={[styles.search, { color: t.text, borderColor: t.border, backgroundColor: t.raised }]}
      />
      {!files ? (
        <View style={styles.center}>
          {error ? (
            <LoadFailed error={error} onRetry={load} />
          ) : (
            <ActivityIndicator color={t.muted} />
          )}
        </View>
      ) : (
        <FlatList
          data={entries}
          keyExtractor={(e) => e.path}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          renderItem={({ item }) => (
            <Row
              icon={
                item.folder ? (
                  <Folder size={17} color={t.muted} />
                ) : (
                  <FileText size={17} color={t.muted} />
                )
              }
              title={query ? item.path : name(item.path)}
              chevron={item.folder}
              onPress={() =>
                item.folder
                  ? router.push({ pathname: "/files", params: { where, dir: item.path } })
                  : router.push({ pathname: "/file", params: { where, path: item.path } })
              }
            />
          )}
          ListEmptyComponent={
            <Text style={[rowStyles.empty, { color: t.muted }]}>
              {query ? "No files match." : "No files here."}
            </Text>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  search: {
    marginHorizontal: 16,
    marginVertical: 8,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: type.body,
  },
});
