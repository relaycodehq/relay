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
import { Stack, router, useIsFocused } from "expo-router";
import { randomUUID } from "expo-crypto";
import * as Clipboard from "expo-clipboard";
import { Ellipsis, RotateCcw } from "lucide-react-native";
import type { ChatMessage, TurnFileChange } from "../../../shared/projects";
import { remoteHistory, titleBridge, markedUnreadBridge, workspaceBridge, type RemoteQueued, type RemoteSettings } from "../../../shared/remote";
import { sentSettings, takenBack, type TakenBack } from "../../../shared/remote-queued";
import type { RelayCommand } from "../../../shared/commands";
import { snoozePresets, wakeLabel } from "../../../shared/chat-activity";
import { latestContext } from "../../../shared/context-usage";
import { openPlan } from "../../../shared/open-plan";
import { preview } from "../../../shared/thread-news";
import { contextAgent } from "../../../shared/recipient";
import { latestSetup } from "../../../shared/worktree-command";
import { outsideBatch, runningBatch } from "../../../shared/subagents";
import { useRemote } from "../remote/RemoteProvider";
import { useThread } from "../remote/useThread";
import { madeThread } from "../remote/new-thread";
import { useSubagents } from "../remote/subagents";
import { markSeen } from "../remote/seen";
import { clearThreadNotice } from "../remote/watch";
import { clearHandedBack, handBack, peekHandedBack } from "../remote/taken-back";
import {
  arrived,
  deliver,
  drop,
  heldIds,
  isOut,
  outgoingMessage,
  reached,
  retry,
  useOutbox,
} from "../remote/outbox";
import {
  knownOf,
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
import { alertFailure } from "../ui/failure";
import { CiStatusButton } from "../ui/CiStatus";
import { Composer, type ComposerHandle, type Outgoing } from "../ui/Composer";
import { KeyboardAware, RevealMessage } from "../ui/KeyboardAware";
import { ReadingBack } from "../ui/AgentRun";
import { messageExtras, threadExtras } from "../ui/menu-extras";
import { MessageView } from "../ui/MessageView";
import { RequestCard } from "../ui/RequestCard";
import { MenuSheet, Sheet, type MenuItem } from "../ui/Sheet";
import { SubagentStrip, SubagentsSheet } from "../ui/Subagents";
import { openThread, useStartedSlot } from "../ui/StartedThreads";
import {
  GoalStrip,
  LimitStrip,
  QueueList,
  StoppedStrip,
  UnsentStrip,
  WaitingStrip,
} from "../ui/ThreadExtras";
import { useForeground } from "../ui/motion";
import { useTurnHaptics } from "../ui/turn-haptics";
import { type, useTheme } from "../ui/theme";
import { useThreadScroll } from "./thread-scroll";

/** An agent's answer, not one of the notes Relay itself writes into the thread. */
const isAnswer = (m: ChatMessage) =>
  m.role === "assistant" &&
  !m.compaction &&
  !m.handoff &&
  !m.reload &&
  !m.worktreeCommand;

/** A thread, or with `rootId` one of its side conversations. */
export function Thread({ id, rootId }: { id: string; rootId?: string }) {
  const remote = useRemote();
  // A handed-over thread keeps its id on another computer; none of the old screen's state follows it.
  return <ThreadBody key={`${remote.active}:${id}:${rootId ?? ""}`} id={id} rootId={rootId} />;
}

function ThreadBody({ id, rootId }: { id: string; rootId?: string }) {
  const remote = useRemote();
  const t = useTheme();
  const { thread, fetched, error, reload, summary, loadEarlier } = useThread(id);
  // Open on the phone counts as read, for the Activity list's unread marks,
  // but only while the app is in front: answers that land in the background
  // are marked when it comes back.
  const updated = summary?.updated;
  const foreground = useForeground();
  const focused = useIsFocused();
  const leavingUnread = useRef(false);
  useEffect(() => {
    if (!updated || !foreground || !focused || leavingUnread.current) return;
    markSeen(id, updated);
    clearThreadNotice(id);
    // The desktop keeps the shared mark; an older one just doesn't know the call.
    if (remote.status === "online")
      void remote.desktop("markProjectChatSeen", id, updated).catch(() => {});
  }, [id, updated, foreground, focused, remote.status, remote.desktop]);
  const [settings, setSettings] = useState<RemoteSettings>();
  const [sheet, setSheet] = useState<
    "thread" | "snooze" | "rename" | "sides" | "agents"
  >();
  const [acting, setActing] = useState<ChatMessage>();
  const composer = useRef<ComposerHandle>(null);
  const all = useMemo(() => thread?.messages ?? [], [thread]);
  // Sent from here and not in the thread yet: shown at once, in their place.
  const computer = remote.active ?? "";
  const outbox = useOutbox(computer, id);
  // Queued and scheduled ones show in the queue instead; those it lost go.
  const held = useMemo(() => heldIds(thread), [thread]);
  useEffect(() => arrived(computer, id, held, fetched), [computer, id, held, fetched]);
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
  // Each acknowledgement asks again, even if another acknowledged send is still pending.
  const fetchSent = outgoing.filter((o) => o.sent).map((o) => o.sent).join(":");
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
  // A thread just made here isn't loaded yet, but the message on its way says what it runs on.
  const sentHere = useMemo(() => {
    const last = outgoing.filter((o) => (o.send.parentId ?? undefined) === rootId).at(-1);
    return last && sentSettings(last.send);
  }, [outgoing, rootId]);
  // Set in the render, so the composer is there on the thread's first frame.
  const startsOn = lastSent
    ? conversationSettings(lastSent, lastParentId, rootId, holder)
    : sentHere;
  if (!settings && startsOn) setSettings(startsOn);
  useEffect(() => {
    if (!loaded || settings) return;
    let live = true;
    void desktopNewThreadSettings(remote.desktop).then(
      (s) => live && setSettings((current) => current ?? s),
    );
    return () => {
      live = false;
    };
  }, [loaded, settings, remote.desktop]);
  // Newest first: the list is inverted so it opens at the latest answer.
  const shown = useMemo(() => [...listed].reverse(), [listed]);
  const { pinned, revealMessage, toBottom, ...scroll } = useThreadScroll(shown);
  const counts = useMemo(() => replyCounts(all), [all]);
  const setupId = useMemo(
    () => (rootId ? undefined : latestSetup(listed)?.id),
    [rootId, listed],
  );
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
    .find(isAnswer);
  useTurnHaptics(id, summary, lastAnswer);
  const canResume =
    !running &&
    !!lastAnswer &&
    ["cancelled", "failed"].includes(lastAnswer.status) &&
    !!thread?.settings &&
    (thread.lastParentId ?? null) === (rootId ?? null);
  const planProvider = running
    ? undefined
    : openPlan([...all, ...outgoing.map(outgoingMessage)], listed);
  // The go-ahead's send: its bubble hides the button once rendered, but a
  // double tap lands before that. Taken back from the outbox, it may go again.
  const goingAhead = useRef<string>(undefined);
  // One made here has no summary until its first message is in.
  const made = madeThread(id);
  const projectId = thread?.projectId ?? summary?.projectId ?? made?.projectId;
  const where =
    thread &&
    (thread.worktree?.path && !thread.worktree.removedAt
      ? workspaceId(thread.projectId, id)
      : thread.projectId);
  // The pushed summary's copy, which a turn's ending doesn't wait for: the
  // loaded thread's goes stale as agents finish between turns.
  const pending = summary ? summary.pending : thread?.pending;
  // Subagents belong to the thread's session, shown on its main conversation.
  const agents = useSubagents(id, {
    enabled: !rootId,
    running,
    pending: pending?.filter((p) => p.kind === "task" && p.agent).length ?? 0,
  });
  const agentBatch = runningBatch(agents.runs);
  const started = useStartedSlot(id, pinned);
  const root = thread?.root;
  const display = useCallback(
    (text: string) => {
      const prefix = root && root.replace(/\/+$/, "") + "/";
      return prefix ? text.split(prefix).join("") : text;
    },
    [root],
  );
  // The strip shows the fan-out's agents and stops them; the waiting strip keeps the rest.
  const waiting = pending && outsideBatch(pending, agentBatch);
  const settled = !!summary?.settledAt && summary.settledAt >= summary.updated;
  const snoozed = !!summary?.snoozedUntil && summary.snoozedUntil > Date.now();

  const act = useCallback(
    (what: string, job: () => Promise<unknown>, unsure?: string) =>
      void job()
        .then(() => reload())
        .catch((e) => alertFailure(e, what, unsure)),
    [reload],
  );
  const rerunSetup = useCallback(
    (m: ChatMessage) =>
      act("Couldn't run setup again", () =>
        remote.desktop("rerunWorktreeSetup", id, m.id),
      ),
    [act, id, remote.desktop],
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
  const steerFromNote = useCallback((text: string) => {
    try {
      composer.current?.restore({ body: text, images: [] });
    } catch (e) {
      Alert.alert("Couldn't add it", e instanceof Error ? e.message : String(e));
    }
  }, []);
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
      case "reload":
        try {
          await remote.desktop("reloadProjectChatSession", id);
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
    id: messageId,
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
        id: messageId,
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
    toBottom();
    return deliver(remote.desktop, computer, id, message);
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
        // These callbacks read refs only when picked, never while building the menu.
        // eslint-disable-next-line react-hooks/refs
        ...threadExtras({
          branch: thread?.worktree?.branch ?? summary?.branch,
          worktree: thread?.worktree?.removedAt ? undefined : thread?.worktree?.path,
          onUnread:
            (remote.overview?.bridge ?? 1) >= markedUnreadBridge
              ? () => {
                  // No trailing seen write should clear the mark while navigation leaves.
                  leavingUnread.current = true;
                  void remote
                    .desktop("triageProjectChat", id, { kind: "unread" })
                    .then(async () => {
                      await remote.refresh().catch(() => {});
                      // Replies share the thread's mark: leave the entire thread.
                      router.dismissTo("/");
                    })
                    .catch((e) => {
                      leavingUnread.current = false;
                      Alert.alert("Couldn't mark it", String(e?.message ?? e));
                    });
                }
              : undefined,
          onRegenerate:
            (remote.overview?.bridge ?? 1) >= titleBridge
              ? () =>
                  act("Couldn't name it", async () => {
                    await remote.desktop("regenerateProjectChatTitle", id);
                    await remote.refresh();
                  })
              : undefined,
        }),
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
    ...messageExtras(m, settings && thread ? composer : undefined),
  ];

  const title = rootId
    ? "Replies"
    : (thread?.title ?? summary?.title ?? made?.title ?? "");
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
                  {projectId && (
                    <CiStatusButton
                      projectId={projectId}
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
        <ReadingBack.Provider value={!pinned}>
        <RevealMessage.Provider value={revealMessage}>
          <FlatList
            inverted
            // Basis 0, not its content's height: otherwise a long thread and the
            // composer share every shortfall and the composer is squeezed under
            // the navigation bar, where only the command list should give way.
            style={styles.thread}
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
                onRerunSetup={!running && item.id === setupId ? rerunSetup : undefined}
                onSteer={rootId ? undefined : steerFromNote}
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
              <View>
                {thread?.earlier && !rootId ? (
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
                ) : null}
              </View>
            }
            contentContainerStyle={styles.list}
            {...scroll}
            // Reading back or tapping an answer puts the keyboard away. Android
            // has no "interactive" mode, which left it open there.
            keyboardDismissMode="on-drag"
            keyboardShouldPersistTaps="handled"
            onTouchStart={Keyboard.dismiss}
          />
        </RevealMessage.Provider>
        </ReadingBack.Provider>
      )}
      {!rootId && summary?.goal && (
        <GoalStrip goal={summary.goal} running={running} />
      )}
      {!rootId && summary?.limitResume && !running && (
        <LimitStrip
          plan={summary.limitResume}
          onSet={(on) =>
            remote
              .desktop("setLimitResume", id, on)
              .catch((e) =>
                Alert.alert("Couldn't change it", e instanceof Error ? e.message : String(e)),
              )
          }
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
      {!rootId && (
        <SubagentStrip
          batch={agentBatch}
          display={display}
          onPress={() => setSheet("agents")}
          error={agents.error}
          onRetry={agents.refresh}
          started={started.shown ? started.family : []}
        />
      )}
      {!rootId && !!waiting?.length && !running && (
        <WaitingStrip
          pending={waiting}
          onStop={async (item) => {
            await remote.desktop("stopProjectChatPending", id, item.id);
            await reload();
          }}
        />
      )}
      <UnsentStrip
        unsent={outgoing.filter((o) => o.error && (o.send.parentId ?? undefined) === rootId)}
        online={remote.status === "online"}
        onRetry={(o) => retry(remote.desktop, o.send.id)}
        onEdit={async (o) => {
          // Unanswered, it may be on the computer already: sent again it would go twice.
          if (o.unsure && !(await remote.whenOnline(20_000)))
            throw new Error(
              `${remote.name} isn't connected yet, so the phone can't tell whether this one arrived. It isn't lost: once connected, the phone checks and it arrives only once.`,
            );
          if (o.unsure && (await reached(remote.call, o, knownOf(thread)))) {
            void reload();
            return Alert.alert("The computer received it", `${remote.name} already accepted this send or is still processing it, so it can't be taken back here.`);
          }
          const restored = composer.current?.restore({
            body: `${o.send.side ? "/btw " : ""}${withoutMention(o.send.body)}`,
            images: o.send.images ?? [],
          });
          if (!restored) throw new Error("The composer isn't ready yet.");
          drop(o.send.id);
        }}
        onUseProjectFolder={
          (remote.overview?.bridge ?? 1) >= workspaceBridge
            ? async (o) => {
                await remote.desktop("selectAgentWorktree", id, null);
                retry(remote.desktop, o.send.id);
              }
            : undefined
        }
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
              if (goingAhead.current && isOut(goingAhead.current)) return;
              // On the planner's own model, as the composer would switch to it.
              const on = composer.current?.settingsOn(planProvider) ?? settings;
              const { send: message, nextSettings } = remotePlanGoAhead(on, planProvider, randomUUID());
              goingAhead.current = message.id;
              deliver(remote.desktop, computer, id, { ...message, ...(rootId ? { parentId: rootId } : {}) });
              setSettings(nextSettings);
            }}
          />
        </View>
      )}
      {settings && projectId && (
        <Composer
          ref={composer}
          onCommand={command}
          projectId={projectId}
          settings={settings}
          onSettings={setSettings}
          running={running}
          disabled={remote.status !== "online"}
          context={latestContext(listed)?.usage}
          placeholder={rootId ? "Reply" : undefined}
          draftKey={draftKey}
          onSend={send}
          onStop={() =>
            act(
              "Couldn't stop it",
              () => remote.desktop("cancelProjectChat", id),
              "Stop may still go through",
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
          label: preview(withoutMention(m.body), 80) || "Side conversation",
          labelLines: 1,
          hint: `${m.side ? "Asked beside the conversation" : m.role === "user" ? "Your message" : "An answer"} · ${counts.get(m.id) ?? 0} ${counts.get(m.id) === 1 ? "reply" : "replies"}`,
          onPress: () => openReplies(m),
        }))}
      />
      <SubagentsSheet
        open={sheet === "agents"}
        batch={agentBatch}
        runs={agents.runs}
        display={display}
        onClose={() => setSheet(undefined)}
        onOpen={(agent) =>
          router.push({
            pathname: "/chat/[id]/agent/[agent]",
            params: { id, agent, ...(root ? { root } : {}) },
          })
        }
        onStop={agents.stop}
        error={agents.error}
        onRetry={agents.refresh}
        started={started}
        onOpenThread={openThread}
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
        // Quote reads the composer's ref only once it's picked, never while drawing.
        // eslint-disable-next-line react-hooks/refs
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
  thread: { flex: 1 },
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
