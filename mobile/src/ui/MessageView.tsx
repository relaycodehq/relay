import { memo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { ChatMessage, TurnFileChange } from "../../../shared/projects";
import { AgentRun } from "./AgentRun";
import { Markdown } from "./Markdown";
import { ProviderIcon, agentNames } from "./ProviderIcon";
import { mono, type, useTheme } from "./theme";

/** The desktop hides the leading `@agent` that addressed a message; see shared/agents. */
export const withoutMention = (body: string) =>
  body.replace(/^@(codex|claude|opencode)(?=\s|$)\s*/i, "");

/** A message laid out like the desktop's (src/components/ProjectChat.tsx). */
export const MessageView = memo(function MessageView({
  message: m,
  root,
  onOpenFile,
}: {
  message: ChatMessage;
  /** The thread's folder, which tool labels leave out. */
  root?: string;
  onOpenFile: (file: TurnFileChange, messageId: string) => void;
}) {
  const t = useTheme();
  if (m.handoff) return <HandoffRow message={m} />;
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
    <View style={styles.turn}>
      <View style={styles.header}>
        {!user && <ProviderIcon provider={m.provider} color={t.text} />}
        <Text style={[styles.author, { color: t.text }]}>
          {user ? (m.author ?? "You") : agentNames[m.provider]}
        </Text>
        {user && (
          <Text style={[styles.meta, { color: t.muted }]}>
            {new Date(m.created).toLocaleTimeString([], {
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
        <View
          style={[
            styles.userBody,
            { borderColor: t.border, backgroundColor: t.raised },
            m.pending && styles.pending,
          ]}
        >
          <Text selectable style={[styles.userText, { color: t.text }]}>
            {withoutMention(m.body)}
          </Text>
        </View>
      ) : m.body.trim() ? (
        <Markdown text={m.body} />
      ) : null}
      {!!m.changes?.length && m.status !== "streaming" && (
        <ChangedFiles files={m.changes} onOpen={(file) => onOpenFile(file, m.id)} />
      )}
      {m.status === "cancelled" && (
        <Text style={[styles.note, { color: t.muted }]}>
          Stopped · partial output kept
        </Text>
      )}
      {!!m.error && m.status !== "cancelled" && (
        <Text style={[styles.note, { color: t.danger }]}>{m.error}</Text>
      )}
    </View>
  );
});

/** A line across the thread with a note in the middle, for compactions and handoffs. */
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
}: {
  files: TurnFileChange[];
  onOpen: (file: TurnFileChange) => void;
}) {
  const t = useTheme();
  const add = files.reduce((n, f) => n + f.additions, 0),
    del = files.reduce((n, f) => n + f.deletions, 0);
  return (
    <View style={[styles.files, { borderColor: t.border, backgroundColor: t.raised }]}>
      <View style={[styles.filesHeader, { borderColor: t.border }]}>
        <Text style={[styles.filesTitle, { color: t.text }]}>
          {files.length === 1 ? "1 file changed" : `${files.length} files changed`}
        </Text>
        <Counts add={add} del={del} />
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
