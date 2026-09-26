import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from "react-native";
import { Stack, useLocalSearchParams } from "expo-router";
import type { RemoteDiff, RemoteDiffLine } from "../../../shared/remote";
import { useRemote } from "../remote/RemoteProvider";
import { mono, type, useTheme } from "../ui/theme";

type Row = { kind: "hunk"; header: string } | RemoteDiffLine;

/** One file a turn changed, as a unified diff with wrapped lines. */
export default function DiffScreen() {
  const { chat, message, path } = useLocalSearchParams<{
    chat: string;
    message: string;
    path: string;
  }>();
  const remote = useRemote();
  const t = useTheme();
  const [diff, setDiff] = useState<RemoteDiff>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    if (remote.status !== "online" || diff) return;
    remote
      .call("turnDiff", chat, message, path)
      .then(setDiff)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [remote.status, chat, message, path, diff]);
  const rows = useMemo<Row[]>(
    () =>
      diff?.hunks.flatMap((h) => [{ kind: "hunk" as const, header: h.header }, ...h.lines]) ?? [],
    [diff],
  );
  const name = path.split("/").at(-1) ?? path;
  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: name }} />
      {path !== name && (
        <Text
          numberOfLines={1}
          ellipsizeMode="head"
          style={[styles.path, { color: t.muted, borderColor: t.border }]}
        >
          {path}
        </Text>
      )}
      {!diff ? (
        <View style={styles.center}>
          {error ? (
            <Text style={[styles.note, { color: t.muted }]}>{error}</Text>
          ) : (
            <ActivityIndicator color={t.muted} />
          )}
        </View>
      ) : diff.binary ? (
        <View style={styles.center}>
          <Text style={[styles.note, { color: t.muted }]}>
            A binary file. Open it on your computer to see the change.
          </Text>
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(_, i) => String(i)}
          initialNumToRender={60}
          renderItem={({ item }) =>
            item.kind === "hunk" ? (
              <Text style={[styles.hunk, { color: t.faint, backgroundColor: t.raised }]}>
                {item.header}
              </Text>
            ) : (
              <View
                style={[
                  styles.line,
                  item.kind === "add" && { backgroundColor: t.addition },
                  item.kind === "del" && { backgroundColor: t.deletion },
                ]}
              >
                <Text style={[styles.gutter, { color: t.faint }]}>
                  {item.kind === "del" ? item.old : item.new}
                </Text>
                <Text style={[styles.sign, { color: t.faint }]}>
                  {item.kind === "add" ? "+" : item.kind === "del" ? "−" : " "}
                </Text>
                <Text selectable style={[styles.code, { color: t.text }]}>
                  {item.text || " "}
                </Text>
              </View>
            )
          }
          ListFooterComponent={
            diff.truncated ? (
              <Text style={[styles.note, styles.footer, { color: t.muted }]}>
                The rest of this diff is on your computer.
              </Text>
            ) : null
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  path: {
    fontFamily: mono,
    fontSize: type.tiny,
    paddingHorizontal: 16,
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  note: { fontSize: type.small, textAlign: "center", lineHeight: 20 },
  footer: { padding: 16 },
  hunk: { fontFamily: mono, fontSize: 11, paddingHorizontal: 12, paddingVertical: 4 },
  line: { flexDirection: "row", paddingRight: 8 },
  gutter: { fontFamily: mono, fontSize: 11, width: 40, textAlign: "right", paddingTop: 2 },
  sign: { fontFamily: mono, fontSize: 12, width: 16, textAlign: "center" },
  code: { fontFamily: mono, fontSize: 12, lineHeight: 18, flex: 1 },
});
