import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Stack, useLocalSearchParams } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Columns2 } from "lucide-react-native";
import type {
  RemoteDiff,
  RemoteDiffLine,
  RemoteDiffSource,
} from "../../../shared/remote";
import { useRemote } from "../remote/RemoteProvider";
import { splitRows, type SplitRow } from "../remote/split-diff";
import { useFullWidth, useWide } from "../ui/panes";
import { LoadFailed } from "../ui/Rows";
import { mono, type, useTheme, type Palette } from "../ui/theme";

type Row = { kind: "hunk"; header: string } | RemoteDiffLine;

const layoutKey = "relay-diff-layout";

/** Side by side, remembered; only offered where two columns fit. */
function useSideBySide() {
  const wide = useWide();
  const [on, setOn] = useState(false);
  useEffect(() => {
    void AsyncStorage.getItem(layoutKey).then((saved) =>
      setOn(saved === "split"),
    );
  }, []);
  const toggle = () =>
    setOn((was) => {
      void AsyncStorage.setItem(layoutKey, was ? "unified" : "split");
      return !was;
    });
  return { offered: wide, on: wide && on, toggle };
}

/** One file's change with wrapped lines: unified, or side by side on a wide screen. */
export default function DiffScreen() {
  const params = useLocalSearchParams<{ source: string }>();
  const source = useMemo(
    () => JSON.parse(params.source) as RemoteDiffSource,
    [params.source],
  );
  const path = source.path;
  const { status, call } = useRemote();
  const t = useTheme();
  const [diff, setDiff] = useState<RemoteDiff>();
  const [error, setError] = useState<string>();
  const load = useCallback(
    () =>
      call("diff", source)
        .then(setDiff)
        .catch((e) => setError(e instanceof Error ? e.message : String(e))),
    [call, source],
  );
  useEffect(() => {
    if (status === "online" && !diff) void load();
  }, [status, diff, load]);
  const sideBySide = useSideBySide();
  // Two columns of code need the whole width, not what's beside the list.
  useFullWidth(sideBySide.on);
  const rows = useMemo<Row[]>(
    () =>
      diff?.hunks.flatMap((h) => [
        { kind: "hunk" as const, header: h.header },
        ...h.lines,
      ]) ?? [],
    [diff],
  );
  const pairs = useMemo(
    () => (diff && sideBySide.on ? splitRows(diff) : []),
    [diff, sideBySide.on],
  );
  const name = path.split("/").at(-1) ?? path;
  return (
    <View style={styles.screen}>
      <Stack.Screen
        options={{
          title: name,
          headerRight: sideBySide.offered
            ? () => (
                <Pressable
                  accessibilityRole="switch"
                  accessibilityLabel="Side by side"
                  accessibilityState={{ checked: sideBySide.on }}
                  hitSlop={10}
                  onPress={sideBySide.toggle}
                  style={[
                    styles.toggle,
                    sideBySide.on && { backgroundColor: t.accentSoft },
                  ]}
                >
                  <Columns2
                    size={19}
                    color={sideBySide.on ? t.accent : t.text}
                  />
                </Pressable>
              )
            : undefined,
        }}
      />
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
            <LoadFailed error={error} onRetry={load} />
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
      ) : sideBySide.on ? (
        <FlatList
          data={pairs}
          keyExtractor={(_, i) => String(i)}
          initialNumToRender={60}
          renderItem={({ item }) => <SplitLine row={item} t={t} />}
          ListFooterComponent={
            diff.truncated ? (
              <Text style={[styles.note, styles.footer, { color: t.muted }]}>
                The rest of this diff is on your computer.
              </Text>
            ) : null
          }
        />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(_, i) => String(i)}
          initialNumToRender={60}
          renderItem={({ item }) =>
            item.kind === "hunk" ? (
              <Text
                style={[
                  styles.hunk,
                  { color: t.faint, backgroundColor: t.raised },
                ]}
              >
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

function SplitLine({ row, t }: { row: SplitRow; t: Palette }) {
  if (row.kind === "hunk")
    return (
      <Text
        style={[styles.hunk, { color: t.faint, backgroundColor: t.raised }]}
      >
        {row.header}
      </Text>
    );
  const side = (
    line: RemoteDiffLine | undefined,
    number: number | undefined,
    changed: string,
  ) => (
    <View
      style={[
        styles.half,
        !line
          ? { backgroundColor: t.raised }
          : line.kind !== "same" && { backgroundColor: changed },
      ]}
    >
      <Text style={[styles.gutter, { color: t.faint }]}>{number}</Text>
      <Text
        selectable
        style={[styles.code, styles.splitCode, { color: t.text }]}
      >
        {line ? line.text || " " : ""}
      </Text>
    </View>
  );
  return (
    <View style={styles.pair}>
      {side(row.left, row.left?.old, t.deletion)}
      <View style={[styles.divider, { backgroundColor: t.border }]} />
      {side(row.right, row.right?.new, t.addition)}
    </View>
  );
}

const styles = StyleSheet.create({
  toggle: { padding: 6, borderRadius: 8 },
  pair: { flexDirection: "row" },
  half: { flex: 1, flexDirection: "row", paddingRight: 6 },
  splitCode: { paddingLeft: 8 },
  divider: { width: StyleSheet.hairlineWidth },
  screen: { flex: 1 },
  path: {
    fontFamily: mono,
    fontSize: type.tiny,
    paddingHorizontal: 16,
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  note: { fontSize: type.small, textAlign: "center", lineHeight: 20 },
  footer: { padding: 16 },
  hunk: {
    fontFamily: mono,
    fontSize: 11,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  line: { flexDirection: "row", paddingRight: 8 },
  gutter: {
    fontFamily: mono,
    fontSize: 11,
    width: 40,
    textAlign: "right",
    paddingTop: 2,
  },
  sign: { fontFamily: mono, fontSize: 12, width: 16, textAlign: "center" },
  code: { fontFamily: mono, fontSize: 12, lineHeight: 18, flex: 1 },
});
