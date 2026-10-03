import { useCallback, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Stack, router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { Minus, Plus, Sparkles } from "lucide-react-native";
import {
  changeKind,
  isStaged,
  isUnstaged,
  type ChangeArea,
  type GitAction,
  type WorkingChange,
  type WorkingTree,
} from "../../../shared/working-tree";
import { useRemote } from "../remote/RemoteProvider";
import { diffHref } from "../remote/links";
import { Button } from "../ui/Button";
import { KeyboardAware } from "../ui/KeyboardAware";
import { LoadFailed, SectionTitle, rowStyles } from "../ui/Rows";
import { mono, type, useTheme } from "../ui/theme";

/** The most files one commit takes, as on the desktop. */
const maxCommitFiles = 1000;

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** What Commit & push takes: every changed file, staged or not, as the desktop's commit sheet picks by default. */
function everyPath(tree: WorkingTree) {
  return tree.changes.filter((c) => !c.conflict).map((c) => c.path);
}

/** Why nothing can be committed right now, when something stands in the way. */
function blocker(tree: WorkingTree) {
  if (tree.operation) return `Finish the ${tree.operation} on your computer first.`;
  if (tree.changes.some((c) => c.conflict)) return "Resolve the conflicts on your computer first.";
  if (!tree.branch) return "Check out a branch on your computer to commit.";
}

/** The desktop's Changes pane: commit and push everything in one go, or stage and commit a part. */
export default function ChangesScreen() {
  const { where } = useLocalSearchParams<{ where: string }>();
  const remote = useRemote();
  const t = useTheme();
  const [tree, setTree] = useState<WorkingTree>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState<string>();
  // Once typed in, the message is yours: a message still being written doesn't replace it.
  const [draft, setDraft] = useState({ text: "", typed: false });
  const [writing, setWriting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const generation = useRef(0);
  const asked = useRef(false);
  const write = useCallback(
    async (paths: string[], quiet?: boolean) => {
      const id = ++generation.current;
      setWriting(true);
      try {
        const text = await remote.desktop("projectCommitMessage", where, paths);
        if (id === generation.current) setDraft((d) => (d.typed ? d : { text, typed: false }));
      } catch (e) {
        if (id === generation.current && !quiet) Alert.alert("Couldn't write it", errorText(e));
      } finally {
        if (id === generation.current) setWriting(false);
      }
    },
    [remote, where],
  );
  const show = useCallback(
    (next: WorkingTree) => {
      setTree(next);
      // Written once for each round of changes, as the desktop's commit sheet does when it opens.
      const paths = everyPath(next);
      if (!asked.current && paths.length > 0 && paths.length <= maxCommitFiles && !blocker(next)) {
        asked.current = true;
        void write(paths, true);
      }
    },
    [write],
  );
  const load = useCallback(async () => {
    if (remote.status !== "online") return;
    try {
      show(await remote.desktop("projectWorkingTree", where));
      setError(undefined);
    } catch (e) {
      setError(errorText(e));
    }
  }, [remote, where, show]);
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );
  const act = async (label: string, action: GitAction) => {
    setBusy(label);
    try {
      show(await remote.desktop("projectGitAction", where, action));
    } catch (e) {
      Alert.alert("Git said no", errorText(e));
      void load();
    } finally {
      setBusy(undefined);
    }
  };
  if (!tree)
    return (
      <View style={styles.center}>
        <Stack.Screen options={{ title: "Changes" }} />
        {error ? <LoadFailed error={error} onRetry={load} /> : <ActivityIndicator color={t.muted} />}
      </View>
    );
  /** Commits these files, or what's staged, then pushes if asked; a failed push leaves the commit in place. */
  const commit = async (paths: string[] | undefined, push: boolean) => {
    setBusy(paths ? "ship" : "commit");
    try {
      let next: WorkingTree;
      try {
        next = await remote.desktop("projectGitAction", where, {
          kind: "commit",
          revision: tree.revision,
          message: draft.text,
          paths,
        });
      } catch (e) {
        Alert.alert("Couldn't commit", errorText(e));
        void load();
        return;
      }
      generation.current++;
      asked.current = false;
      setWriting(false);
      setDraft({ text: "", typed: false });
      show(next);
      if (!push) return;
      setBusy("push");
      try {
        show(await remote.desktop("projectGitAction", where, { kind: "push", revision: next.revision }));
      } catch (e) {
        Alert.alert(
          "Committed, but the push failed",
          `Your commit is on ${next.branch}; only the push failed. You can push it from Remote.\n\n${errorText(e)}`,
        );
        void load();
      }
    } finally {
      setBusy(undefined);
    }
  };
  const staged = tree.changes.filter(isStaged);
  const working = tree.changes.filter(isUnstaged);
  const allPaths = everyPath(tree);
  const stop = blocker(tree);
  // Committing while a message is on its way would go without it, unless you've typed your own.
  const ready = !busy && !stop && !!draft.text.trim() && !(writing && !draft.typed);
  const canShip = ready && allPaths.length > 0 && allPaths.length <= maxCommitFiles;
  const canCommitStaged = ready && staged.length > 0;
  // With some of it staged, the message describes that part.
  const partial = staged.length > 0 && working.length > 0;
  const writeFor = partial ? staged.map((f) => f.path) : allPaths;
  const canWrite = !writing && !busy && writeFor.length > 0 && writeFor.length <= maxCommitFiles;
  const section = (title: string, area: ChangeArea, files: WorkingChange[]) =>
    files.length > 0 && (
      <View>
        <View style={styles.sectionHead}>
          <SectionTitle>{title}</SectionTitle>
          <Pressable
            accessibilityRole="button"
            hitSlop={8}
            disabled={!!busy}
            onPress={() =>
              void act(area === "staged" ? "unstage" : "stage", {
                kind: area === "staged" ? "unstage" : "stage",
                revision: tree.revision,
                paths: files.map((f) => f.path),
              })
            }
          >
            <Text style={[styles.all, { color: t.accent }]}>
              {area === "staged" ? "Unstage all" : "Stage all"}
            </Text>
          </Pressable>
        </View>
        {files.map((f) => {
          const code = area === "staged" ? f.index : f.worktree;
          const kind = changeKind(code, f.conflict);
          const slash = f.path.lastIndexOf("/");
          return (
            <View key={`${area}:${f.path}`} style={styles.file}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Open diff of ${f.path}`}
                style={styles.fileMain}
                onPress={() => router.push(diffHref({ kind: "working", where, path: f.path, area }))}
              >
                <Text
                  style={[
                    styles.code,
                    {
                      color:
                        kind === "added"
                          ? t.additionText
                          : kind === "deleted" || kind === "conflict"
                            ? t.deletionText
                            : t.muted,
                    },
                  ]}
                >
                  {f.conflict ? "!" : code === "?" ? "U" : code}
                </Text>
                <Text numberOfLines={1} style={styles.path}>
                  <Text style={{ color: t.text }}>{f.path.slice(slash + 1)}</Text>
                  {slash > 0 && <Text style={{ color: t.faint }}>  {f.path.slice(0, slash)}</Text>}
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${area === "staged" ? "Unstage" : "Stage"} ${f.path}`}
                hitSlop={10}
                disabled={!!busy}
                onPress={() =>
                  void act(area === "staged" ? "unstage" : "stage", {
                    kind: area === "staged" ? "unstage" : "stage",
                    revision: tree.revision,
                    paths: [f.path],
                  })
                }
                style={[styles.stage, { borderColor: t.border }]}
              >
                {area === "staged" ? <Minus size={15} color={t.text} /> : <Plus size={15} color={t.text} />}
              </Pressable>
            </View>
          );
        })}
      </View>
    );
  const pushTo = tree.pushTarget ?? tree.upstream;
  // As on the desktop, Commit & push only pushes where the branch pushes to.
  const shipTo = tree.pushTarget;
  const count = `${allPaths.length} ${allPaths.length === 1 ? "file" : "files"}`;
  const hint =
    stop ??
    (allPaths.length > maxCommitFiles
      ? `Over ${maxCommitFiles} files. Stage a part and commit that.`
      : shipTo
        ? `${count}, then push to ${shipTo}`
        : `${count} on ${tree.branch} · no remote to push to`);
  return (
    <KeyboardAware>
      <Stack.Screen options={{ title: tree.branch || "Changes" }} />
      <ScrollView
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            tintColor={t.muted}
            colors={[t.accent]}
            onRefresh={() => {
              setRefreshing(true);
              void load().finally(() => setRefreshing(false));
            }}
          />
        }
      >
        {tree.operation && (
          <Text style={[styles.note, { color: t.danger }]}>
            A {tree.operation} is in progress. Finish it on your computer.
          </Text>
        )}
        {!tree.changes.length && (
          <Text style={[rowStyles.empty, { color: t.muted }]}>No uncommitted changes.</Text>
        )}
        {section("Staged changes", "staged", staged)}
        {section("Working changes", "unstaged", working)}
        <SectionTitle>Remote</SectionTitle>
        <Text style={[styles.note, { color: t.muted }]}>
          {pushTo
            ? `${tree.ahead ? `${tree.ahead} to push` : "Nothing to push"}${tree.behind ? ` · ${tree.behind} to pull` : ""} · ${pushTo}`
            : "This branch has no remote yet."}
        </Text>
        {tree.outgoing.map((c) => (
          <Text key={c.sha} numberOfLines={1} style={[styles.outgoing, { color: t.text }]}>
            <Text style={{ color: t.faint, fontFamily: mono }}>{c.sha.slice(0, 7)} </Text>
            {c.subject}
          </Text>
        ))}
        <View style={styles.row}>
          <Button label={busy === "fetch" ? "Fetching…" : "Fetch"} disabled={!!busy} onPress={() => void act("fetch", { kind: "fetch" })} />
          {tree.behind > 0 && (
            <Button
              label={busy === "pull" ? "Pulling…" : "Pull"}
              disabled={!!busy || !!tree.operation}
              onPress={() => void act("pull", { kind: "pull", revision: tree.revision })}
            />
          )}
          <Button
            label={busy === "push" ? "Pushing…" : "Push"}
            primary={!tree.changes.length}
            disabled={!!busy || !tree.branch || !pushTo || (!!tree.upstream && !tree.ahead)}
            onPress={() =>
              // Push shows exactly where and what before it goes, as on the desktop.
              Alert.alert(
                `Push ${tree.outgoing.length || "the branch"}${tree.outgoing.length ? ` commit${tree.outgoing.length === 1 ? "" : "s"}` : ""}?`,
                `To ${pushTo ?? `origin/${tree.branch}`}. A normal push, never forced.`,
                [
                  { text: "Cancel", style: "cancel" },
                  { text: "Push", onPress: () => void act("push", { kind: "push", revision: tree.revision }) },
                ],
              )
            }
          />
        </View>
      </ScrollView>
      {!!tree.changes.length && (
        // Pinned under the list, so the one-step commit is in reach however many files changed.
        <View style={[styles.dock, { borderColor: t.border, backgroundColor: t.background }]}>
          <View style={styles.dockHead}>
            <Text numberOfLines={1} style={[styles.hint, { color: stop ? t.danger : t.muted }]}>
              {hint}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: !canWrite }}
              hitSlop={8}
              disabled={!canWrite}
              onPress={() => {
                setDraft((d) => ({ ...d, typed: false }));
                void write(writeFor);
              }}
              style={styles.writeIt}
            >
              <Sparkles size={13} color={t.accent} />
              <Text style={[styles.writeText, { color: t.accent }]}>
                {writing ? "Writing…" : partial ? "Write for staged" : "Write it for me"}
              </Text>
            </Pressable>
          </View>
          <TextInput
            accessibilityLabel="Commit message"
            multiline
            placeholder={writing && !draft.typed ? "Writing a message…" : "Commit message"}
            placeholderTextColor={t.faint}
            value={draft.text}
            onChangeText={(text) => setDraft({ text, typed: true })}
            maxLength={16000}
            style={[styles.message, { color: t.text, borderColor: t.border, backgroundColor: t.raised }]}
          />
          <View style={styles.buttons}>
            {staged.length > 0 && (
              <Button
                label={busy === "commit" ? "Committing…" : "Commit staged"}
                disabled={!canCommitStaged}
                onPress={() => void commit(undefined, false)}
              />
            )}
            <Button
              label={
                busy === "ship" ? "Committing…" : busy === "push" ? "Pushing…" : shipTo ? "Commit & push" : "Commit"
              }
              primary
              disabled={!canShip}
              onPress={() => void commit(allPaths, !!shipTo)}
            />
          </View>
        </View>
      )}
    </KeyboardAware>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  list: { paddingBottom: 40 },
  note: { fontSize: type.small, lineHeight: 19, paddingHorizontal: 16, paddingVertical: 6 },
  sectionHead: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", paddingRight: 16 },
  all: { fontSize: type.tiny, fontWeight: "600", paddingBottom: 6 },
  file: { flexDirection: "row", alignItems: "center", paddingRight: 16, minHeight: 46 },
  fileMain: { flex: 1, flexDirection: "row", alignItems: "center", gap: 10, paddingLeft: 16, paddingVertical: 10 },
  code: { width: 14, fontFamily: mono, fontSize: 12, textAlign: "center" },
  path: { flex: 1, fontFamily: mono, fontSize: 13 },
  stage: { width: 32, height: 32, borderRadius: 8, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  dock: { paddingHorizontal: 16, paddingVertical: 10, gap: 8, borderTopWidth: StyleSheet.hairlineWidth },
  dockHead: { flexDirection: "row", alignItems: "center", gap: 12 },
  hint: { flex: 1, fontSize: type.tiny },
  writeIt: { flexDirection: "row", alignItems: "center", gap: 5 },
  writeText: { fontSize: type.tiny, fontWeight: "600" },
  message: { minHeight: 64, maxHeight: 120, borderWidth: 1, borderRadius: 12, padding: 12, fontSize: type.body, textAlignVertical: "top" },
  row: { flexDirection: "row", gap: 10, paddingHorizontal: 16, paddingTop: 10 },
  buttons: { flexDirection: "row", gap: 10 },
  outgoing: { fontSize: type.small, paddingHorizontal: 16, paddingVertical: 3 },
});
