import { useCallback, useEffect, useMemo, useState } from "react";
import { randomUUID } from "expo-crypto";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  SectionList,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { Redo2, Undo2 } from "lucide-react-native";
import type { TurnFileChange, WorktreeStatus } from "../../../shared/projects";
import { useRemote } from "../remote/RemoteProvider";
import { useThread } from "../remote/useThread";
import { composeSend, desktopNewThreadSettings } from "../remote/compose";
import { diffHref, workspaceId } from "../remote/links";
import { Button } from "../ui/Button";
import { MergeSheet } from "../ui/MergeSheet";
import { agentNames } from "../ui/ProviderIcon";
import { rowStyles } from "../ui/Rows";
import { mono, type, useTheme } from "../ui/theme";

/**
 * The desktop's Turn changes pane: what one agent turn changed, from Relay's
 * snapshots around it, or with `worktree` everything the thread's worktree
 * has that the branch it came from doesn't yet.
 */
export default function TurnScreen() {
  const { chat, message, worktree } = useLocalSearchParams<{
    chat: string;
    message?: string;
    worktree?: string;
  }>();
  const remote = useRemote();
  const t = useTheme();
  const { thread, reload, error: threadError } = useThread(chat);
  const [status, setStatus] = useState<WorktreeStatus>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState<string>();
  const [merging, setMerging] = useState(false);
  const { desktop, status: connection } = remote;
  const loadStatus = useCallback(() => {
    if (!worktree || connection !== "online") return;
    desktop("projectWorktree", chat)
      .then((s) => {
        setStatus(s);
        setError(undefined);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [worktree, connection, desktop, chat]);
  useEffect(() => loadStatus(), [loadStatus]);
  const turn = message
    ? thread?.messages.find((m) => m.id === message)
    : undefined;
  const files = worktree ? status?.files : turn?.changes;
  const sections = useMemo(() => {
    const byFolder = new Map<string, TurnFileChange[]>();
    for (const f of files ?? []) {
      const slash = f.path.lastIndexOf("/");
      const folder = slash > 0 ? f.path.slice(0, slash) : "";
      byFolder.set(folder, [...(byFolder.get(folder) ?? []), f]);
    }
    return [...byFolder]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([title, data]) => ({ title, data }));
  }, [files]);
  const rewind = useCallback(
    async (
      paths: string[] | null,
      mode: "revert" | "redo",
      force = false,
    ): Promise<void> => {
      if (!message) return;
      setBusy(paths?.[0] ?? "all");
      try {
        const { conflicts } = await remote.desktop(
          "rewindProjectTurn",
          chat,
          message,
          paths,
          mode,
          force,
        );
        await reload();
        if (conflicts.length)
          Alert.alert(
            "Nothing was changed",
            `${conflicts.length === 1 ? `${conflicts[0]!.split("/").at(-1)} was` : `${conflicts.length} files were`} edited after ${mode === "revert" ? "this turn" : "the rollback"} in ways that overlap it.`,
            [
              { text: "Cancel", style: "cancel" },
              {
                text: "Overwrite anyway",
                style: "destructive",
                onPress: () => void rewind(paths, mode, true),
              },
            ],
          );
      } catch (e) {
        Alert.alert(
          "Couldn't roll back",
          e instanceof Error ? e.message : String(e),
        );
      } finally {
        setBusy(undefined);
      }
    },
    [remote, chat, message, reload],
  );
  const title = worktree
    ? (status?.branch ?? "Worktree")
    : turn
      ? `${agentNames[turn.provider]} · ${new Date(turn.ended ?? turn.created).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
      : "Changes";
  const reverted = files?.filter((f) => f.revertedBy).length ?? 0;
  const all = files?.length ?? 0;
  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title }} />
      {!files ? (
        <View style={styles.center}>
          {(worktree ? error : threadError?.message) ? (
            <>
              <Text style={[rowStyles.empty, { color: t.muted }]}>
                {worktree ? error : threadError?.message}
              </Text>
              <Button
                label="Try again"
                style={styles.retry}
                onPress={() => (worktree ? loadStatus() : void reload())}
              />
            </>
          ) : (
            <ActivityIndicator color={t.muted} />
          )}
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(f) => f.path}
          stickySectionHeadersEnabled={false}
          ListHeaderComponent={
            <View>
              <View style={styles.head}>
                <Text style={[styles.summary, { color: t.muted }]}>
                  {worktree
                    ? status?.landed
                      ? `Landed ${status.landed.by === "pr" ? "through its pull request" : "in"} ${status.from ?? "its branch"}.`
                      : `${all} ${all === 1 ? "file" : "files"} ${status?.from ? `ahead of ${status.from}` : "changed"}`
                    : `${all} ${all === 1 ? "file" : "files"} changed${reverted ? ` · ${reverted} rolled back` : ""}`}
                </Text>
                {!worktree && all > 0 && (
                  <Pressable
                    accessibilityRole="button"
                    disabled={!!busy}
                    hitSlop={8}
                    onPress={() =>
                      reverted === all
                        ? void rewind(null, "redo")
                        : Alert.alert(
                            `Roll back ${all - reverted} files?`,
                            "They go back to how they were before this turn. Later edits are kept where they merge.",
                            [
                              { text: "Cancel", style: "cancel" },
                              {
                                text: "Roll back",
                                style: "destructive",
                                onPress: () => void rewind(null, "revert"),
                              },
                            ],
                          )
                    }
                    style={styles.all}
                  >
                    {reverted === all ? (
                      <Redo2 size={15} color={t.accent} />
                    ) : (
                      <Undo2 size={15} color={t.accent} />
                    )}
                    <Text style={[styles.allText, { color: t.accent }]}>
                      {reverted === all ? "Redo all" : "Roll back all"}
                    </Text>
                  </Pressable>
                )}
              </View>
              {worktree &&
                status?.from &&
                !status.landed &&
                !status.removed &&
                status.files.length > 0 && (
                  <Button
                    label={`Merge into ${status.from}`}
                    primary
                    style={styles.merge}
                    onPress={() => setMerging(true)}
                  />
                )}
            </View>
          }
          renderSectionHeader={({ section }) =>
            section.title ? (
              <Text style={[styles.folder, { color: t.faint }]}>
                {section.title}
              </Text>
            ) : null
          }
          renderItem={({ item: f }) => (
            <View style={styles.file}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Open diff of ${f.path}`}
                style={styles.fileMain}
                onPress={() =>
                  router.push(
                    worktree
                      ? diffHref({
                          kind: "worktree",
                          chatId: chat,
                          path: f.path,
                        })
                      : diffHref({
                          kind: "turn",
                          chatId: chat,
                          messageId: message!,
                          path: f.path,
                        }),
                  )
                }
              >
                <Text
                  numberOfLines={1}
                  style={[
                    styles.name,
                    { color: f.revertedBy ? t.muted : t.text },
                    f.revertedBy && styles.struck,
                  ]}
                >
                  {f.path.slice(f.path.lastIndexOf("/") + 1)}
                </Text>
                {f.binary ? (
                  <Text style={[styles.count, { color: t.muted }]}>binary</Text>
                ) : (
                  <>
                    <Text style={[styles.count, { color: t.additionText }]}>
                      +{f.additions}
                    </Text>
                    <Text style={[styles.count, { color: t.deletionText }]}>
                      −{f.deletions}
                    </Text>
                  </>
                )}
              </Pressable>
              {!worktree && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={
                    f.revertedBy ? `Redo ${f.path}` : `Roll back ${f.path}`
                  }
                  disabled={!!busy}
                  hitSlop={10}
                  onPress={() =>
                    void rewind([f.path], f.revertedBy ? "redo" : "revert")
                  }
                  style={[
                    styles.rewind,
                    { borderColor: t.border },
                    busy === f.path && { opacity: 0.5 },
                  ]}
                >
                  {f.revertedBy ? (
                    <Redo2 size={14} color={t.text} />
                  ) : (
                    <Undo2 size={14} color={t.text} />
                  )}
                </Pressable>
              )}
            </View>
          )}
          ListEmptyComponent={
            <Text style={[rowStyles.empty, { color: t.muted }]}>
              Nothing changed.
            </Text>
          }
        />
      )}
      {worktree && thread && (
        <MergeSheet
          where={workspaceId(thread.projectId, chat)}
          open={merging}
          onClose={() => setMerging(false)}
          onMerged={loadStatus}
          onAskAgent={async (text) => {
            await desktop(
              "sendProjectChat",
              chat,
              composeSend(
                thread.settings ??
                  (await desktopNewThreadSettings(desktop)),
                text,
                {
                  id: randomUUID(),
                },
              ),
            );
            router.back();
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  retry: { flexGrow: 0, alignSelf: "stretch", marginTop: 16 },
  merge: { marginHorizontal: 16, marginBottom: 8 },
  screen: { flex: 1 },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  head: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 16,
    gap: 12,
  },
  summary: { fontSize: type.small, flex: 1 },
  all: { flexDirection: "row", alignItems: "center", gap: 6 },
  allText: { fontSize: type.small, fontWeight: "600" },
  folder: {
    fontFamily: mono,
    fontSize: type.tiny,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 4,
  },
  file: {
    flexDirection: "row",
    alignItems: "center",
    paddingRight: 16,
    minHeight: 46,
  },
  fileMain: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingLeft: 16,
    paddingVertical: 10,
  },
  name: { flex: 1, fontFamily: mono, fontSize: 13 },
  struck: { textDecorationLine: "line-through" },
  count: { fontFamily: mono, fontSize: type.tiny },
  rewind: {
    width: 32,
    height: 32,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 12,
  },
});
