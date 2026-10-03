import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Keyboard,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Stack, router } from "expo-router";
import { randomUUID } from "expo-crypto";
import * as Clipboard from "expo-clipboard";
import { Ellipsis, RotateCcw } from "lucide-react-native";
import type { ChatMessage, TurnFileChange } from "../../../shared/projects";
import { remoteHistory, type RemoteQueued, type RemoteSettings } from "../../../shared/remote";
import { takenBack, type TakenBack } from "../../../shared/remote-queued";
import type { RelayCommand } from "../../../shared/commands";
import { snoozePresets, wakeLabel } from "../../../shared/chat-activity";
import { latestContext } from "../../../shared/context-usage";
import { contextAgent } from "../../../shared/recipient";
import { useRemote } from "../remote/RemoteProvider";
import { useThread } from "../remote/useThread";
import { markSeen } from "../remote/seen";
import { clearHandedBack, handBack, peekHandedBack } from "../remote/taken-back";
import {
  arrived,
  deliver,
  drop,
  outgoingMessage,
  retry,
  useOutbox,
} from "../remote/outbox";
import {
  mainMessages,
  replyCounts,
  rootOf,
  sideConversation,
} from "../remote/chat-state";
import {
  composeSend,
  conversationSettings,
  desktopNewThreadSettings,
  remotePlanGoAhead,
  withoutMention,
} from "../../../shared/remote-compose";
import { confirmAgentSwitch } from "../remote/agent-switch";
import { diffHref, workspaceId } from "../remote/links";
import { Button } from "../ui/Button";
import { CiStatusButton } from "../ui/CiStatus";
import { Composer, type ComposerHandle, type Outgoing } from "../ui/Composer";
import { KeyboardAware } from "../ui/KeyboardAware";
import { MessageView } from "../ui/MessageView";
import { RequestCard } from "../ui/RequestCard";
import { MenuSheet, Sheet, type MenuItem } from "../ui/Sheet";
import {
  QueueList,
  StoppedStrip,
  UnsentStrip,
  WaitingStrip,
} from "../ui/ThreadExtras";
import { useForeground } from "../ui/motion";
import { type, useTheme } from "../ui/theme";

/** A thread, or with `rootId` one of its side conversations. */
export function Thread({ id, rootId }: { id: string; rootId?: string }) {
  const remote = useRemote();
  const t = useTheme();
  const { thread, error, reload, summary, loadEarlier } = useThread(id);
  // Open on the phone counts as read, for the Activity list's unread marks,
  // but only while the app is in front: answers that land in the background
  // are marked when it comes back.
  const updated = summary?.updated;
  const foreground = useForeground();
  useEffect(() => {
    if (!updated || !foreground) return;
    markSeen(id, updated);
    // The desktop keeps the shared mark; an older one just doesn't know the call.
    void remote.desktop("markProjectChatSeen", id, updated).catch(() => {});
  }, [id, updated, foreground]);
  const [settings, setSettings] = useState<RemoteSettings>();
  const [sheet, setSheet] = useState<
    "thread" | "snooze" | "rename" | "sides"
  >();
  const [acting, setActing] = useState<ChatMessage>();
  const composer = useRef<ComposerHandle>(null);
  const all = useMemo(() => thread?.messages ?? [], [thread]);
  // Sent from here and not in the thread yet: shown at once, in their place.
  const outbox = useOutbox(id);
  const held = useMemo(() => new Set(all.map((m) => m.id)), [all]);
  useEffect(() => arrived(held), [held]);
  const outgoing = useMemo(
    () => outbox.filter((o) => !held.has(o.send.id)),
    [outbox, held],
  );
  const listed = useMemo(() => {
    const own = rootId ? sideConversation(all, rootId) : mainMessages(all);
    const mine = outgoing
      .map(outgoingMessage)
      .filter((m) => (m.parentId ?? undefined) === rootId);
    return mine.length ? [...own, ...mine] : own;
  }, [all, rootId, outgoing]);
  // The desktop took one the thread doesn't show yet: ask for it.
  const fetchSent = outgoing.some((o) => o.sent);
  useEffect(() => {
    if (fetchSent) void reload();
  }, [fetchSent, reload]);
  // The agent holding this conversation's context, which a send to another one takes over from.
  const holder = useMemo(() => contextAgent(listed, rootId), [listed, rootId]);
  // Starts from what the thread last sent, as the desktop's composer does,
  // but on the agent holding this conversation when that send was a reply
  // elsewhere; before its first message, as a new thread would.
  const loaded = !!thread;
  const lastSent = thread?.settings;
  const lastParentId = thread?.lastParentId;
  useEffect(() => {
    if (!loaded || settings) return;
    if (lastSent)
      return setSettings(conversationSettings(lastSent, lastParentId, rootId, holder));
    let live = true;
    void desktopNewThreadSettings(remote.desktop).then(
      (s) => live && setSettings((current) => current ?? s),
    );
    return () => {
      live = false;
    };
  }, [loaded, lastSent, lastParentId, rootId, holder, settings, remote.desktop]);
  // Newest first: the list is inverted so it opens at the latest answer.
  const shown = useMemo(() => [...listed].reverse(), [listed]);
  const counts = useMemo(() => replyCounts(all), [all]);
  // Side conversations: `/btw` questions and messages someone replied to.
  const sides = useMemo(
    () => all.filter((m) => !m.parentId && (m.side || counts.has(m.id))),
    [all, counts],
  );
  const running = rootId
    ? listed.some((m) => m.status === "streaming")
    : !!(thread?.running ?? summary?.running);
  const lastAnswer = [...listed]
    .reverse()
    .find((m) => m.role === "assistant" && !m.compaction && !m.handoff);
  const canResume =
    !running &&
    !!lastAnswer &&
    ["cancelled", "failed"].includes(lastAnswer.status) &&
    !!thread?.settings &&
    (thread.lastParentId ?? null) === (rootId ?? null);
  const last = listed.at(-1);
  const planProvider =
    !running && last?.status === "complete" && last.proposedPlan
      ? last.provider
      : undefined;
  const where =
    thread &&
    (thread.worktree?.path && !thread.worktree.removedAt
      ? workspaceId(thread.projectId, id)
      : thread.projectId);
  const settled = !!summary?.settledAt && summary.settledAt >= summary.updated;
  const snoozed = !!summary?.snoozedUntil && summary.snoozedUntil > Date.now();

  const act = useCallback(
    (what: string, job: () => Promise<unknown>) =>
      void job()
        .then(() => reload())
        .catch((e) =>
          Alert.alert(what, e instanceof Error ? e.message : String(e)),
        ),
    [reload],
  );
  const openFile = useCallback(
    (file: TurnFileChange, messageId: string) =>
      router.push(
        diffHref({ kind: "turn", chatId: id, messageId, path: file.path }),
      ),
    [id],
  );
  const openTurn = useCallback(
    (m: ChatMessage) =>
      router.push({ pathname: "/turn", params: { chat: id, message: m.id } }),
    [id],
  );
  const fork = useCallback(
    (m: ChatMessage) =>
      void remote
        .desktop("forkProjectChat", id, m.id)
        .then((f) => router.push(`/chat/${f.id}`))
        .catch((e) => Alert.alert("Couldn't fork it", String(e?.message ?? e))),
    [remote, id],
  );
  const openReplies = useCallback(
    (m: ChatMessage) => router.push(`/chat/${id}/reply/${m.id}`),
    [id],
  );
  const rewind = useCallback(
    async (
      m: ChatMessage,
      paths: string[] | null,
      mode: "revert" | "redo",
      force: boolean,
    ) => {
      const result = await remote.desktop(
        "rewindProjectTurn",
        id,
        m.id,
        paths,
        mode,
        force,
      );
      await reload();
      return result;
    },
    [remote, id, reload],
  );
  const queueAction = async (
    action: "steer" | "remove" | "move",
    messageId: string,
    index?: number,
  ) => {
    try {
      await remote.desktop(
        "projectChatQueueAction",
        id,
        action,
        messageId,
        index,
      );
      await reload();
      return true;
    } catch (e) {
      Alert.alert(
        "Couldn't change the queue",
        e instanceof Error ? e.message : String(e),
      );
      return false;
    }
  };
  const draftKey = rootId ? `${id}:${rootId}` : id;
  // A queued reply taken back on the main screen arrives here, in its side conversation.
  const [handedBack] = useState(() => peekHandedBack(draftKey));
  const tookBack = useRef(false);
  useEffect(() => {
    if (!handedBack || tookBack.current || !settings || !thread || !composer.current) return;
    tookBack.current = true;
    clearHandedBack(draftKey);
    void takeBack(handedBack.back, handedBack.messageId).catch(fail);
  });
  const fail = (e: unknown) =>
    Alert.alert("Couldn't take it back", e instanceof Error ? e.message : String(e));
  /** The composer gets the message before the queue loses it, so nothing is lost if either step fails. */
  const takeBack = async (back: TakenBack, messageId: string) => {
    const undo = composer.current?.restore(back);
    if (!undo) throw new Error("The composer isn't ready yet.");
    if (!(await queueAction("remove", messageId))) return undo();
    if (back.settings) setSettings(back.settings);
  };
  const editQueued = async (item: RemoteQueued) => {
    try {
      // Only a desktop that sends `settings` can hand the screenshots over; older ones get the text alone.
      const images = item.images && item.settings ? await remote.desktop("projectChatQueuedImages", id, item.id) : [];
      const back = takenBack(item, images);
      if (back.parentId && !rootId) {
        handBack(`${id}:${back.parentId}`, { back, messageId: item.id });
        router.push(`/chat/${id}/reply/${back.parentId}`);
      } else await takeBack(back, item.id);
    } catch (e) {
      fail(e);
    }
  };
  /** Relay's workspace commands from the composer, as the desktop's thread runs them. */
  const command = async (
    name: RelayCommand,
    args: string,
  ): Promise<boolean | string> => {
    if (!thread || !where) return "Wait for the thread to load.";
    switch (name) {
      case "changes":
        router.push({ pathname: "/changes", params: { where } });
        return true;
      case "files":
        router.push({ pathname: "/files", params: { where } });
        return true;
      case "new":
      case "clear":
        router.push({
          pathname: "/new",
          params: { project: thread.projectId },
        });
        return true;
      case "compact":
        try {
          await remote.desktop(
            "compactProjectChat",
            id,
            rootId ?? null,
            args || undefined,
          );
          await reload();
          return true;
        } catch (e) {
          return e instanceof Error ? e.message : String(e);
        }
      default:
        return "Open that one on your computer for now.";
    }
  };
  const send = async ({
    body,
    settings: using,
    images,
    delivery,
    sendAt,
  }: Outgoing) => {
    // `/btw` asks beside the conversation, as in the desktop's composer.
    const side = !rootId && /^\/btw\s/i.test(body);
    if (!side && !(await confirmAgentSwitch(using.provider, holder))) return false;
    const message = composeSend(
      using,
      side ? body.replace(/^\/btw\s+/i, "") : body,
      {
        id: randomUUID(),
        ...(rootId ? { parentId: rootId } : {}),
        ...(side ? { side: true } : {}),
        ...(delivery ? { delivery } : {}),
        ...(sendAt ? { sendAt } : {}),
        images: images.map(({ name, mimeType, dataUrl }) => ({
          name,
          mimeType,
          dataUrl,
        })),
      },
    );
    // A plain send shows in the thread at once; queued and scheduled ones
    // land in the queue, which only the desktop's answer fills.
    if (!delivery && !sendAt) return deliver(remote.desktop, id, message);
    await remote.desktop("sendProjectChat", id, message);
    await reload();
  };

  const threadItems: MenuItem[] = where
    ? [
        { label: "Rename", onPress: () => setSheet("rename") },
        settled
          ? {
              label: "Move back to active",
              onPress: () =>
                act("Couldn't move it", () =>
                  remote.desktop("triageProjectChat", id, { kind: "unsettle" }),
                ),
            }
          : {
              label: "Mark as done",
              onPress: () =>
                act("Couldn't mark it done", () =>
                  remote.desktop("triageProjectChat", id, { kind: "settle" }),
                ),
            },
        snoozed
          ? {
              label: "Wake up now",
              onPress: () =>
                act("Couldn't wake it", () =>
                  remote.desktop("triageProjectChat", id, { kind: "wake" }),
                ),
            }
          : { label: "Snooze…", onPress: () => setSheet("snooze") },
        ...(sides.length
          ? [
              {
                label: "Side conversations",
                hint: `${sides.length} beside this one`,
                onPress: () => setSheet("sides"),
              },
            ]
          : []),
        ...(thread?.worktree?.path && !thread.worktree.removedAt
          ? [
              {
                label: "Worktree changes",
                hint: `Everything ${thread.worktree.branch ?? "its branch"} has that ${thread.worktree.from ?? "the checkout"} doesn't yet.`,
                onPress: () =>
                  router.push({
                    pathname: "/turn",
                    params: { chat: id, worktree: "1" },
                  }),
              },
            ]
          : []),
        {
          label: "Changes",
          onPress: () =>
            router.push({ pathname: "/changes", params: { where } }),
        },
        {
          label: "Files",
          onPress: () => router.push({ pathname: "/files", params: { where } }),
        },
        {
          label: "History",
          onPress: () =>
            router.push({ pathname: "/history", params: { where } }),
        },
        {
          label: "Compact the conversation",
          hint: "The agent summarises it to free up its context.",
          onPress: () =>
            act("Couldn't compact it", () =>
              remote.desktop("compactProjectChat", id),
            ),
        },
        {
          label: "Archive",
          destructive: true,
          onPress: () =>
            Alert.alert(
              "Archive this thread?",
              "It leaves your lists; the desktop keeps it.",
              [
                { text: "Cancel", style: "cancel" },
                {
                  text: "Archive",
                  style: "destructive",
                  onPress: () =>
                    void remote
                      .desktop("triageProjectChat", id, { kind: "archive" })
                      .then(() => router.back())
                      .catch((e) =>
                        Alert.alert(
                          "Couldn't archive it",
                          String(e?.message ?? e),
                        ),
                      ),
                },
              ],
            ),
        },
      ]
    : [];
  const messageItems = (m: ChatMessage): MenuItem[] => [
    {
      label: "Copy",
      onPress: () =>
        void Clipboard.setStringAsync(
          m.role === "user" ? withoutMention(m.body) : m.body,
        ),
    },
    ...(!rootId
      ? [
          {
            label: "Reply",
            hint: "A side conversation that leaves this one as it is.",
            onPress: () => openReplies(rootOf(all, m)),
          },
        ]
      : []),
    ...(m.role === "assistant" &&
    m.status === "complete" &&
    !m.parentId &&
    !m.side
      ? [
          {
            label: "Fork from here",
            hint: "A new thread with the conversation up to this answer.",
            onPress: () =>
              void remote
                .desktop("forkProjectChat", id, m.id)
                .then((fork) => router.push(`/chat/${fork.id}`))
                .catch((e) =>
                  Alert.alert("Couldn't fork it", String(e?.message ?? e)),
                ),
          },
        ]
      : []),
  ];

  const title = rootId ? "Replies" : (thread?.title ?? summary?.title ?? "");
  // Questions and approvals belong to the whole thread, replies included.
  const request = thread?.requests?.[0];
  return (
    <KeyboardAware>
      <Stack.Screen
        options={{
          title,
          headerRight: rootId
            ? undefined
            : () => (
                <View style={styles.headerActions}>
                  {thread && (
                    <CiStatusButton
                      projectId={thread.projectId}
                      chatId={id}
                      running={running}
                    />
                  )}
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Thread actions"
                    hitSlop={10}
                    disabled={!where}
                    onPress={() => setSheet("thread")}
                  >
                    <Ellipsis size={22} color={t.text} />
                  </Pressable>
                </View>
              ),
        }}
      />
      {!thread && !outgoing.length ? (
        <View style={styles.center}>
          {error ? (
            <>
              <Text style={[styles.note, { color: t.muted }]}>
                {error.message}
              </Text>
              <Button
                label="Try again"
                style={styles.grow0}
                onPress={() => void reload()}
              />
            </>
          ) : remote.status !== "online" ? (
            <Text style={[styles.note, { color: t.muted }]}>
              This thread hasn’t been opened on this phone, so there’s no copy
              to read until {remote.name} is back.
            </Text>
          ) : (
            <ActivityIndicator color={t.muted} />
          )}
        </View>
      ) : (
        <FlatList
          inverted
          data={shown}
          keyExtractor={(m) => m.id}
          renderItem={({ item }) => (
            <MessageView
              chatId={id}
              message={item}
              root={thread?.root}
              where={where}
              replies={rootId ? undefined : counts.get(item.id)}
              onOpenFile={openFile}
              onActions={setActing}
              onReplies={openReplies}
              onReply={rootId ? undefined : (m) => openReplies(rootOf(all, m))}
              onFork={rootId ? undefined : fork}
              onOpenTurn={openTurn}
              onRewind={rewind}
            />
          )}
          ListHeaderComponent={
            <View>
              {canResume && (
                <Pressable
                  accessibilityRole="button"
                  onPress={() =>
                    act("Couldn't resume", async () => {
                      if (!(await confirmAgentSwitch(settings?.provider, holder))) return;
                      await remote.desktop(
                        "resumeProjectChat",
                        id,
                        settings && {
                          provider: settings.provider,
                          choice: settings.choice,
                          runtimeMode: settings.runtimeMode,
                          interactionMode: settings.interactionMode,
                          ...(settings.contextWindow
                            ? { contextWindow: settings.contextWindow }
                            : {}),
                        },
                      );
                    })
                  }
                  style={styles.resume}
                >
                  <RotateCcw size={14} color={t.accent} />
                  <Text style={[styles.resumeText, { color: t.accent }]}>
                    Resume answer
                  </Text>
                </Pressable>
              )}
              {!rootId && thread && (
                <QueueList
                  queue={thread.queue}
                  scheduled={thread.scheduled ?? []}
                  running={running}
                  compacting={thread.messages.some(
                    (m) => m.compaction && m.status === "streaming",
                  )}
                  paused={thread.queuePaused}
                  onSteer={async (messageId) =>
                    void (await queueAction("steer", messageId))
                  }
                  onRemove={async (messageId) =>
                    void (await queueAction("remove", messageId))
                  }
                  onMove={async (messageId, index) =>
                    void (await queueAction("move", messageId, index))
                  }
                  onEdit={editQueued}
                />
              )}
            </View>
          }
          ListFooterComponent={
            thread?.earlier && !rootId ? (
              loadEarlier ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={loadEarlier}
                  style={styles.earlierButton}
                >
                  <Text style={[styles.earlier, { color: t.accent }]}>
                    Load {Math.min(remoteHistory, thread.earlier)} earlier{" "}
                    {thread.earlier === 1 ? "message" : "messages"}
                    {thread.earlier > remoteHistory
                      ? ` of ${thread.earlier}`
                      : ""}
                  </Text>
                </Pressable>
              ) : (
                <Text style={[styles.earlier, { color: t.faint }]}>
                  {thread.earlier} earlier{" "}
                  {thread.earlier === 1 ? "message is" : "messages are"} on your
                  computer
                </Text>
              )
            ) : null
          }
          contentContainerStyle={styles.list}
          // New messages and a growing answer land at offset 0, the visual
          // bottom of the inverted list. Without this, everything you were
          // reading shifts away; with it the anchor holds still, and within
          // 80px of the bottom the list follows, as the desktop does.
          maintainVisibleContentPosition={{
            minIndexForVisible: 0,
            autoscrollToTopThreshold: 80,
          }}
          // Reading back or tapping an answer puts the keyboard away. Android
          // has no "interactive" mode, which left it open there.
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          onTouchStart={Keyboard.dismiss}
        />
      )}
      {!rootId && !!thread?.stopped?.items.length && (
        <StoppedStrip
          items={thread.stopped.items}
          onResolve={async (action) => {
            await remote.desktop("resolveStoppedWork", id, action);
            await reload();
          }}
        />
      )}
      {!rootId && !!thread?.pending?.length && !running && (
        <WaitingStrip
          pending={thread.pending}
          onStop={async (item) => {
            await remote.desktop("stopProjectChatPending", id, item.id);
            await reload();
          }}
        />
      )}
      <UnsentStrip
        unsent={outgoing.filter((o) => o.error)}
        onRetry={(o) => retry(remote.desktop, o.send.id)}
        onEdit={(o) => {
          drop(o.send.id);
          composer.current?.restore({
            body: withoutMention(o.send.body),
            images: o.send.images ?? [],
          });
        }}
      />
      {request && (
        <RequestCard
          key={request.id}
          request={request}
          more={(thread?.requests?.length ?? 1) - 1}
          onRespond={async (response) => {
            await remote.desktop(
              "respondProjectChat",
              id,
              request.id,
              response,
            );
            await reload();
          }}
        />
      )}
      {planProvider && settings && (
        <View style={styles.plan}>
          <Button
            label="Implement plan"
            primary
            onPress={() => {
              // On the planner's own model, as the composer would switch to it.
              const on = composer.current?.settingsOn(planProvider) ?? settings;
              const { send: message, nextSettings } = remotePlanGoAhead(on, planProvider, randomUUID());
              remote
                .desktop("sendProjectChat", id, { ...message, ...(rootId ? { parentId: rootId } : {}) })
                .then(() => {
                  setSettings(nextSettings);
                  return reload();
                })
                .catch((e) => Alert.alert("Couldn't send it", String(e?.message ?? e)));
            }}
          />
        </View>
      )}
      {settings && thread && (
        <Composer
          ref={composer}
          onCommand={command}
          projectId={thread.projectId}
          settings={settings}
          onSettings={setSettings}
          running={running}
          disabled={remote.status !== "online"}
          context={latestContext(listed)?.usage}
          placeholder={rootId ? "Reply" : undefined}
          draftKey={draftKey}
          onSend={send}
          onStop={() =>
            act("Couldn't stop it", () =>
              remote.desktop("cancelProjectChat", id),
            )
          }
        />
      )}
      <MenuSheet
        open={sheet === "thread"}
        title={title}
        items={threadItems}
        onClose={() => setSheet(undefined)}
      />
      <MenuSheet
        open={sheet === "snooze"}
        title="Snooze until"
        items={snoozePresets(new Date()).map((p) => ({
          label: p.label,
          hint: wakeLabel(p.until, new Date()),
          onPress: () =>
            act("Couldn't snooze it", () =>
              remote.desktop("triageProjectChat", id, {
                kind: "snooze",
                until: p.until,
              }),
            ),
        }))}
        onClose={() => setSheet(undefined)}
      />
      <MenuSheet
        open={sheet === "sides"}
        title="Side conversations"
        onClose={() => setSheet(undefined)}
        items={sides.map((m) => ({
          label:
            withoutMention(m.body).split("\n")[0]!.slice(0, 80) ||
            "Side conversation",
          hint: `${m.side ? "Asked beside the conversation" : m.role === "user" ? "Your message" : "An answer"} · ${counts.get(m.id) ?? 0} ${counts.get(m.id) === 1 ? "reply" : "replies"}`,
          onPress: () => openReplies(m),
        }))}
      />
      <RenameSheet
        open={sheet === "rename"}
        title={thread?.title ?? ""}
        onClose={() => setSheet(undefined)}
        onSave={async (name) => {
          await remote.desktop("renameProjectChat", id, name);
          await remote.refresh();
          await reload();
        }}
      />
      <MenuSheet
        open={!!acting}
        items={acting ? messageItems(acting) : []}
        onClose={() => setActing(undefined)}
      />
    </KeyboardAware>
  );
}

function RenameSheet({
  open,
  title,
  onClose,
  onSave,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  onSave: (title: string) => Promise<void>;
}) {
  const t = useTheme();
  const [value, setValue] = useState(title);
  const [error, setError] = useState<string>();
  useEffect(() => {
    if (open) setValue(title);
  }, [open, title]);
  return (
    <Sheet open={open} title="Rename thread" onClose={onClose}>
      <View style={styles.form}>
        <TextInput
          accessibilityLabel="Thread name"
          autoFocus
          value={value}
          onChangeText={setValue}
          style={[
            styles.input,
            {
              color: t.text,
              borderColor: t.border,
              backgroundColor: t.background,
            },
          ]}
        />
        {error && (
          <Text style={[styles.note, { color: t.danger }]}>{error}</Text>
        )}
        <Button
          label="Save"
          primary
          disabled={!value.trim() || value.trim() === title}
          onPress={() =>
            void onSave(value.trim())
              .then(onClose)
              .catch((e) =>
                setError(e instanceof Error ? e.message : String(e)),
              )
          }
        />
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 14,
    padding: 24,
  },
  note: { fontSize: type.small, textAlign: "center" },
  grow0: { flexGrow: 0 },
  list: { paddingVertical: 8 },
  earlier: { fontSize: type.tiny, textAlign: "center", padding: 16 },
  earlierButton: { paddingVertical: 4 },
  headerActions: { flexDirection: "row", alignItems: "center" },
  resume: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "center",
    padding: 10,
  },
  resumeText: { fontSize: type.small, fontWeight: "600" },
  plan: { paddingHorizontal: 12, paddingBottom: 8 },
  form: { paddingHorizontal: 20, gap: 12, paddingBottom: 8 },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: type.body,
  },
});
