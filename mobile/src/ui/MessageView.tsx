import { memo, useCallback, useMemo, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { router } from "expo-router";
import { Check, Copy, Redo2, Reply, Split, Undo2 } from "lucide-react-native";
import { sentLabel } from "../../../shared/chat-activity";
import type { ChatMessage, TurnFileChange } from "../../../shared/projects";
import { withoutMention } from "../../../shared/remote-compose";
import { reloadNote } from "../../../shared/session-reload";
import { fileHref, fileLinkTarget, folderHref } from "../remote/links";
import { AgentRun } from "./AgentRun";
import { localImagePath } from "../../../shared/answer-images";
import {
  AnswerImage,
  MessageImages,
  imageFailed,
  keyOf,
  messageImages,
  type Source,
} from "./Images";
import { Lightbox, type LightboxImage } from "./Lightbox";
import { Markdown, type OpenLink, type ShowImage } from "./Markdown";
import { ProviderIcon, agentNames } from "./ProviderIcon";
import { mono, type, useTheme } from "./theme";

export type Rewind = (
  paths: string[] | null,
  mode: "revert" | "redo",
  force: boolean,
) => Promise<{ conflicts: string[] }>;

const hideImage: ShowImage = () => null;

/** A message laid out like the desktop's (src/features/thread/ProjectChat.tsx). */
export const MessageView = memo(function MessageView({
  chatId,
  message: m,
  root,
  where,
  replies,
  onOpenFile,
  onActions,
  onReplies,
  onReply,
  onFork,
  onOpenTurn,
  onRewind,
}: {
  chatId: string;
  message: ChatMessage;
  /** The thread's folder, which tool labels leave out. */
  root?: string;
  /** Where its files are read (links.ts workspaceId); without it only files the turn changed open from the answer. */
  where?: string;
  /** Replies under this message, shown as a link to its side conversation. */
  replies?: number;
  onOpenFile: (file: TurnFileChange, messageId: string) => void;
  onActions?: (message: ChatMessage) => void;
  onReplies?: (message: ChatMessage) => void;
  /** Starts or opens a side conversation on this answer. */
  onReply?: (message: ChatMessage) => void;
  onFork?: (message: ChatMessage) => void;
  /** Everything the turn changed, on a screen of its own. */
  onOpenTurn?: (message: ChatMessage) => void;
  onRewind?: (message: ChatMessage, ...args: Parameters<Rewind>) => ReturnType<Rewind>;
}) {
  const t = useTheme();
  const changes = m.changes;
  const openLink = useCallback<OpenLink>(
    (value, inline) => {
      const target = root ? fileLinkTarget(value, inline, root, changes) : null;
      if (target?.kind === "diff") return () => onOpenFile(target.change, m.id);
      if (!target || !where) return;
      const href = target.kind === "folder" ? folderHref(where, target.path) : fileHref(where, target.path);
      return () => router.push(href);
    },
    [root, where, changes, m.id, onOpenFile],
  );
  const images = useMemo(() => messageImages(chatId, m, root), [chatId, m, root]);
  const [viewing, setViewing] = useState<{ images: LightboxImage[]; index: number }>();
  const openImage = useCallback(
    (source: Source) => {
      // The list is fixed while it's open; ones that failed to load are left out.
      const key = keyOf(source);
      const shown = images.all.filter(
        (image) => keyOf(image.source) === key || !imageFailed(image.source),
      );
      setViewing({ images: shown, index: shown.findIndex((image) => keyOf(image.source) === key) });
    },
    [images],
  );
  const showImage = useCallback<ShowImage>(
    (src, alt) => {
      const path = root ? localImagePath(src, root) : null;
      return path ? (
        <AnswerImage
          source={{ kind: "read", chatId, messageId: m.id, path }}
          alt={alt}
          onOpen={openImage}
        />
      ) : undefined;
    },
    [chatId, m.id, root, openImage],
  );
  if (m.handoff) return <HandoffRow message={m} />;
  if (m.reload) return <StatusRow>{reloadNote(m.reload)}</StatusRow>;
  if (m.compaction)
    return (
      <StatusRow failed={m.status === "failed"}>
        {m.status === "streaming"
          ? "Compacting context…"
          : m.status === "complete"
            ? "Context compacted"
            : m.status === "cancelled"
              ? "Compaction stopped"
              : (m.error ?? "Compaction failed")}
      </StatusRow>
    );
  const user = m.role === "user";
  return (
    <Pressable
      style={styles.turn}
      // Long-press only; its buttons and links stay separate for screen readers.
      accessible={false}
      onLongPress={onActions && (() => onActions(m))}
      delayLongPress={350}
    >
      <View style={styles.header}>
        {!user && <ProviderIcon provider={m.provider} color={t.text} />}
        <Text style={[styles.author, { color: t.text }]}>
          {user ? (m.author ?? "You") : agentNames[m.provider]}
        </Text>
        {user && (
          <Text style={[styles.meta, { color: t.muted }]}>
            {/* Only the phone's own sends are pending; see remote/outbox. */}
            {m.pending && !m.error
              ? "Sending…"
              : new Date(m.created).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
          </Text>
        )}
        {!user && m.author && (
          <Text style={[styles.meta, { color: t.muted }]}>via {m.author}</Text>
        )}
        {m.unprompted && (
          <Text style={[styles.meta, { color: t.muted }]}>started on its own</Text>
        )}
      </View>
      {!user && <AgentRun message={m} root={root} />}
      {user ? (
        // A screenshot sent on its own leaves nothing for the bubble to hold.
        !!withoutMention(m.body).trim() && (
          <View
            style={[
              styles.userBody,
              { borderColor: t.border, backgroundColor: t.raised },
              // A /btw question: a dashed outline and nothing else, as on the desktop.
              m.side && [styles.side, { borderColor: t.muted, backgroundColor: t.background }],
              m.pending && styles.pending,
            ]}
          >
            <Text selectable style={[styles.userText, { color: t.text }]}>
              {withoutMention(m.body)}
            </Text>
          </View>
        )
      ) : m.body.trim() ? (
        <Markdown
          text={m.body}
          onLink={openLink}
          // The desktop only reads an image once the saved answer names it.
          image={m.status === "streaming" ? hideImage : showImage}
        />
      ) : null}
      <MessageImages images={images.strip} onOpen={openImage} />
      {viewing && (
        <Lightbox
          images={viewing.images}
          index={viewing.index}
          onClose={() => setViewing(undefined)}
        />
      )}
      {!!m.changes?.length && m.status !== "streaming" && (
        <ChangedFiles
          files={m.changes}
          onOpen={(file) => onOpenFile(file, m.id)}
          onOpenAll={onOpenTurn && (() => onOpenTurn(m))}
          onRewind={onRewind && ((...args) => onRewind(m, ...args))}
        />
      )}
      {m.status === "cancelled" && (
        <Text style={[styles.note, { color: t.muted }]}>
          Stopped · partial output kept
        </Text>
      )}
      {!!m.error && m.status !== "cancelled" && (
        <Text style={[styles.note, { color: t.danger }]}>{m.error}</Text>
      )}
      {!user && m.status !== "streaming" && (
        <MessageActions
          message={m}
          onReply={onReply && (() => onReply(m))}
          onFork={onFork && m.status === "complete" && !m.parentId && !m.side ? () => onFork(m) : undefined}
        />
      )}
      {!!replies && onReplies && (
        <Pressable
          accessibilityRole="button"
          onPress={() => onReplies(m)}
          hitSlop={8}
          style={styles.replies}
        >
          <Reply size={13} color={t.accent} />
          <Text style={[styles.note, { color: t.accent }]}>
            {replies} {replies === 1 ? "reply" : "replies"}
          </Text>
        </Pressable>
      )}
    </Pressable>
  );
});

/** A line across the thread with a note in the middle, for compactions and handoffs. */
/** The desktop's MessageActions: when it was sent, copy, fork, reply. */
function MessageActions({
  message,
  onReply,
  onFork,
}: {
  message: ChatMessage;
  onReply?: () => void;
  onFork?: () => void;
}) {
  const t = useTheme();
  const [copied, setCopied] = useState(false);
  return (
    <View style={styles.actions}>
      <Text style={[styles.meta, { color: t.faint }]}>{sentLabel(message.ended ?? message.created, new Date())}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={copied ? "Copied" : "Copy answer"}
        hitSlop={8}
        onPress={() =>
          void Clipboard.setStringAsync(message.body).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          })
        }
      >
        {copied ? <Check size={16} color={t.muted} /> : <Copy size={16} color={t.muted} />}
      </Pressable>
      {onFork && (
        <Pressable accessibilityRole="button" accessibilityLabel="Fork into a new thread" hitSlop={8} onPress={onFork}>
          <Split size={16} color={t.muted} />
        </Pressable>
      )}
      {onReply && (
        <Pressable accessibilityRole="button" accessibilityLabel="Reply to message" hitSlop={8} onPress={onReply}>
          <Reply size={16} color={t.muted} />
        </Pressable>
      )}
    </View>
  );
}

function StatusRow({
  children,
  failed,
  action,
}: {
  children: string;
  failed?: boolean;
  action?: { label: string; onPress: () => void };
}) {
  const t = useTheme();
  return (
    <View style={styles.status} accessibilityRole="text">
      <View style={[styles.rule, { backgroundColor: t.border }]} />
      <Text style={[styles.statusText, { color: failed ? t.danger : t.muted }]}>
        {children}
      </Text>
      {action && (
        <Pressable accessibilityRole="button" hitSlop={8} onPress={action.onPress}>
          <Text style={[styles.statusText, { color: t.accent }]}>{action.label}</Text>
        </Pressable>
      )}
      <View style={[styles.rule, { backgroundColor: t.border }]} />
    </View>
  );
}

function HandoffRow({ message: m }: { message: ChatMessage }) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  const { from, to } = m.handoff!;
  const switched = `Switched from ${agentNames[from]} to ${agentNames[to]}`;
  const note = m.status === "complete" && m.body.trim();
  return (
    <View>
      <StatusRow
        action={note ? { label: open ? "Hide note" : "Show note", onPress: () => setOpen(!open) } : undefined}
      >
        {m.status === "streaming"
          ? `${agentNames[from]} is writing a handoff note for ${agentNames[to]}…`
          : note
            ? switched
            : `${switched} · no handoff note`}
      </StatusRow>
      {open && note && (
        <View style={[styles.handoffNote, { borderColor: t.border }]}>
          <Markdown text={note} small />
        </View>
      )}
    </View>
  );
}

function ChangedFiles({
  files,
  onOpen,
  onOpenAll,
  onRewind,
}: {
  files: TurnFileChange[];
  onOpen: (file: TurnFileChange) => void;
  onOpenAll?: () => void;
  onRewind?: Rewind;
}) {
  const t = useTheme();
  const [working, setWorking] = useState(false);
  const add = files.reduce((n, f) => n + f.additions, 0),
    del = files.reduce((n, f) => n + f.deletions, 0);
  const reverted = files.filter((f) => f.revertedBy).length;
  const redo = reverted === files.length;
  // The desktop's ChangedFilesCard: confirm a rollback of several files, and
  // offer to overwrite when later edits overlap it.
  const rewind = async (mode: "revert" | "redo", force = false) => {
    if (!onRewind) return;
    setWorking(true);
    try {
      const { conflicts } = await onRewind(null, mode, force);
      if (conflicts.length)
        Alert.alert(
          "Nothing was changed",
          `${conflicts.length === 1 ? `${conflicts[0]!.split("/").at(-1)} was` : `${conflicts.length} files were`} edited after ${mode === "revert" ? "this turn" : "the rollback"} in ways that overlap it.`,
          [
            { text: "Cancel", style: "cancel" },
            { text: "Overwrite anyway", style: "destructive", onPress: () => void rewind(mode, true) },
          ],
        );
    } catch (e) {
      Alert.alert("Couldn't roll back", e instanceof Error ? e.message : String(e));
    } finally {
      setWorking(false);
    }
  };
  return (
    <View style={[styles.files, { borderColor: t.border, backgroundColor: t.raised }]}>
      <View style={[styles.filesHeader, { borderColor: t.border }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityHint="Opens everything this turn changed"
          disabled={!onOpenAll}
          onPress={onOpenAll}
          style={styles.filesTitleWrap}
        >
          <Text style={[styles.filesTitle, { color: t.text }]}>
            {files.length === 1 ? "1 file changed" : `${files.length} files changed`}
          </Text>
        </Pressable>
        <Counts add={add} del={del} />
        {onRewind && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={redo ? "Redo this turn's changes" : "Roll back this turn's changes"}
            disabled={working}
            hitSlop={8}
            onPress={() =>
              redo
                ? void rewind("redo")
                : files.length - reverted > 1
                  ? Alert.alert(
                      `Roll back ${files.length - reverted} files?`,
                      "They go back to how they were before this turn. Later edits are kept where they merge.",
                      [
                        { text: "Cancel", style: "cancel" },
                        { text: "Roll back", style: "destructive", onPress: () => void rewind("revert") },
                      ],
                    )
                  : void rewind("revert")
            }
            style={[styles.rewind, working && { opacity: 0.5 }]}
          >
            {redo ? <Redo2 size={14} color={t.muted} /> : <Undo2 size={14} color={t.muted} />}
            <Text style={[styles.count, { color: t.muted }]}>{redo ? "Redo" : "Roll back"}</Text>
          </Pressable>
        )}
      </View>
      {files.map((f) => {
        const slash = f.path.lastIndexOf("/");
        return (
          <Pressable
            key={f.path}
            accessibilityRole="button"
            accessibilityLabel={`Open diff of ${f.path}`}
            onPress={() => onOpen(f)}
            style={({ pressed }) => [
              styles.file,
              pressed && { backgroundColor: t.hover },
            ]}
          >
            <Text numberOfLines={1} style={styles.filePath}>
              <Text style={{ color: t.text, textDecorationLine: f.revertedBy ? "line-through" : "none" }}>
                {f.path.slice(slash + 1)}
              </Text>
              {slash > 0 && (
                <Text style={{ color: t.faint }}>  {f.path.slice(0, slash)}</Text>
              )}
            </Text>
            {f.binary ? (
              <Text style={[styles.count, { color: t.muted }]}>binary</Text>
            ) : (
              <Counts add={f.additions} del={f.deletions} />
            )}
          </Pressable>
        );
      })}
    </View>
  );
}


function Counts({ add, del }: { add: number; del: number }) {
  const t = useTheme();
  return (
    <View style={styles.counts}>
      <Text style={[styles.count, { color: t.additionText }]}>+{add}</Text>
      <Text style={[styles.count, { color: t.deletionText }]}>−{del}</Text>
    </View>
  );
}


const styles = StyleSheet.create({
  turn: { gap: 8, paddingHorizontal: 16, paddingVertical: 12 },
  header: { flexDirection: "row", alignItems: "center", gap: 7, flexWrap: "wrap" },
  author: { fontSize: type.small, fontWeight: "600" },
  meta: { fontSize: type.tiny },
  userBody: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  pending: { opacity: 0.6 },
  userText: { fontSize: type.body, lineHeight: 22 },
  note: { fontSize: type.small, lineHeight: 19 },
  status: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  rule: { flex: 1, height: StyleSheet.hairlineWidth },
  statusText: { fontSize: type.tiny, textAlign: "center", flexShrink: 1 },
  handoffNote: {
    marginHorizontal: 40,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderLeftWidth: 2,
  },
  files: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    overflow: "hidden",
  },
  filesHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  filesTitle: { fontSize: type.small, fontWeight: "600" },
  filesTitleWrap: { flex: 1 },
  rewind: { flexDirection: "row", alignItems: "center", gap: 5, marginLeft: 12 },
  side: { borderStyle: "dashed", borderWidth: 1 },
  replies: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start" },
  actions: { flexDirection: "row", alignItems: "center", gap: 18, marginTop: 2 },
  file: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
    minHeight: 40,
  },
  filePath: { flex: 1, fontSize: type.small, fontFamily: mono },
  counts: { flexDirection: "row", gap: 8 },
  count: { fontSize: type.tiny, fontFamily: mono },
});
