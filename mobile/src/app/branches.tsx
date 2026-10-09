import { useCallback, useState } from "react";
import { ActivityIndicator, Alert, SectionList, StyleSheet, Text, TextInput, View } from "react-native";
import { Stack, useFocusEffect, useLocalSearchParams } from "expo-router";
import { Check, GitBranch } from "lucide-react-native";
import type { BranchList, BranchRef } from "../../../shared/branches";
import { useRemote } from "../remote/RemoteProvider";
import { Button } from "../ui/Button";
import { LoadFailed, Row } from "../ui/Rows";
import { Sheet } from "../ui/Sheet";
import { type, useTheme } from "../ui/theme";

/** The checkout's branches: switch to one, or start a new one from here. */
export default function BranchesScreen() {
  const { project } = useLocalSearchParams<{ project: string }>();
  const { desktop, status } = useRemote();
  const t = useTheme();
  const [list, setList] = useState<BranchList>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const load = useCallback(async () => {
    if (status !== "online") return;
    try {
      setList(await desktop("projectBranches", project));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [desktop, status, project]);
  useFocusEffect(useCallback(() => {
    void load();
  }, [load]));
  const change = async (kind: "switch" | "create", branch: string) => {
    if (!list) return;
    setBusy(true);
    try {
      setList(
        await desktop("projectChangeBranch", project, {
          kind,
          name: branch,
          current: list.current,
          head: list.head,
        }),
      );
      setCreating(false);
      setName("");
    } catch (e) {
      Alert.alert(kind === "switch" ? "Couldn't switch" : "Couldn't create it", e instanceof Error ? e.message : String(e));
      void load();
    } finally {
      setBusy(false);
    }
  };
  const row = (b: BranchRef) => (
    <Row
      icon={b.current ? <Check size={17} color={t.accent} /> : <GitBranch size={17} color={t.muted} />}
      title={b.name}
      subtitle={b.current ? "Checked out" : b.worktree ? "Checked out in a worktree" : undefined}
      chevron={false}
      onPress={
        b.current || b.worktree || busy
          ? undefined
          : () =>
              Alert.alert(`Switch to ${b.name}?`, "Uncommitted changes that would be overwritten stop the switch.", [
                { text: "Cancel", style: "cancel" },
                { text: "Switch", onPress: () => void change("switch", b.name) },
              ])
      }
    />
  );
  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: "Branches" }} />
      {!list ? (
        <View style={styles.center}>
          {error ? (
            <LoadFailed error={error} onRetry={load} />
          ) : (
            <ActivityIndicator color={t.muted} />
          )}
        </View>
      ) : (
        <SectionList
          sections={[
            { title: "Local", data: list.branches.filter((b) => !b.remote) },
            { title: "Remote", data: list.branches.filter((b) => b.remote) },
          ].filter((s) => s.data.length)}
          keyExtractor={(b) => b.ref}
          stickySectionHeadersEnabled={false}
          ListHeaderComponent={
            <View style={styles.new}>
              <Button label="New branch from here" disabled={busy} onPress={() => setCreating(true)} />
            </View>
          }
          renderSectionHeader={({ section }) => (
            <Text style={[styles.section, { color: t.muted }]}>{section.title}</Text>
          )}
          renderItem={({ item }) => row(item)}
        />
      )}
      <Sheet open={creating} title={`New branch from ${list?.current ?? "here"}`} onClose={() => setCreating(false)}>
        <View style={styles.form}>
          <TextInput
            accessibilityLabel="Branch name"
            autoFocus
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="feature/phone-remote"
            placeholderTextColor={t.faint}
            value={name}
            onChangeText={setName}
            style={[styles.input, { color: t.text, borderColor: t.border, backgroundColor: t.background }]}
          />
          <Button
            label={busy ? "Creating…" : "Create and switch"}
            primary
            disabled={busy || !name.trim()}
            onPress={() => void change("create", name.trim())}
          />
        </View>
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  new: { padding: 16 },
  section: { fontSize: type.tiny, fontWeight: "600", paddingHorizontal: 16, paddingTop: 12, paddingBottom: 6 },
  form: { paddingHorizontal: 20, gap: 12, paddingBottom: 8 },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: type.body },
});
