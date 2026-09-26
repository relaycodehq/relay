import { memo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  Bot,
  ChevronDown,
  ChevronRight,
  FilePen,
  FileText,
  Globe,
  Search,
  Terminal,
  Wrench,
} from "lucide-react-native";
import type {
  AgentActivity,
  ChatMessage,
  TurnFileChange,
} from "../../../shared/projects";
import {
  doneLabel,
  duration,
  liveLabel,
  summarizeActivity,
} from "../../../shared/activity-labels";
import { sentLabel } from "../../../shared/chat-activity";
import { Markdown } from "./Markdown";
import { ProviderIcon, agentNames } from "./ProviderIcon";
import { mono, type, useTheme } from "./theme";

/** The desktop hides the leading `@agent` that addressed a message; see shared/agents. */
export const withoutMention = (body: string) =>
  body.replace(/^@(codex|claude|opencode)(?=\s|$)\s*/i, "");

const icons = {
  command: Terminal,
  read: FileText,
  file: FilePen,
  search: Search,
  web: Globe,
  agent: Bot,
  tool: Wrench,
} satisfies Record<AgentActivity["kind"], unknown>;

export const MessageView = memo(function MessageView({
  message,
  onOpenFile,
}: {
  message: ChatMessage;
  onOpenFile: (file: TurnFileChange, messageId: string) => void;
}) {
  return message.role === "user" ? (
    <UserMessage message={message} />
  ) : (
    <AgentMessage message={message} onOpenFile={onOpenFile} />
  );
});

function UserMessage({ message }: { message: ChatMessage }) {
  const t = useTheme();
  return (
    <View style={styles.turn}>
      <View style={styles.header}>
        <Text style={[styles.author, { color: t.text }]}>
          {message.author ?? "You"}
        </Text>
        <Text style={[styles.time, { color: t.muted }]}>
          {sentLabel(message.created, new Date())}
        </Text>
      </View>
      <View
        style={[
          styles.userBody,
          { borderColor: t.border, backgroundColor: t.raised },
          message.pending && styles.pending,
        ]}
      >
        <Text selectable style={[styles.userText, { color: t.text }]}>
          {withoutMention(message.body)}
        </Text>
      </View>
    </View>
  );
}

function AgentMessage({
  message,
  onOpenFile,
}: {
  message: ChatMessage;
  onOpenFile: (file: TurnFileChange, messageId: string) => void;
}) {
  const t = useTheme();
  const streaming = message.status === "streaming";
  const calls = (
    message.trace
      ? message.trace.flatMap((e) => (e.kind === "activity" ? [e.activity] : []))
      : (message.activity ?? [])
  ).filter((a) => !a.parentId);
  const running = [...calls].reverse().find((a) => a.status === "running");
  const finished = calls.filter((a) => a.status !== "running");
  const marker = message.compaction
    ? "Compacted the conversation"
    : message.handoff
      ? `Handoff from ${agentNames[message.handoff.from]} to ${agentNames[message.handoff.to]}`
      : message.unprompted
        ? "Started on its own"
        : undefined;
  return (
    <View style={styles.turn}>
      <View style={styles.header}>
        <ProviderIcon provider={message.provider} color={t.text} />
        <Text style={[styles.author, { color: t.text }]}>
          {agentNames[message.provider]}
        </Text>
        {marker && (
          <Text style={[styles.time, { color: t.muted }]}>{marker}</Text>
        )}
      </View>
      {finished.length > 0 && (
        <ActivitySummary
          calls={finished}
          commentary={
            message.trace?.flatMap((e) =>
              e.kind === "commentary" ? [e.text] : [],
            ) ?? []
          }
          took={
            !streaming && message.ended
              ? duration(message.ended - message.created)
              : undefined
          }
        />
      )}
      {streaming && (
        // The one thing that moves in a turn: what the agent is doing now.
        <View style={styles.live}>
          <ActivityIndicator size="small" color={t.muted} />
          <Text numberOfLines={1} style={[styles.liveText, { color: t.muted }]}>
            {running
              ? running.progress
                ? `${liveLabel(running)} · ${running.progress}`
                : liveLabel(running)
              : message.body
                ? "Writing…"
                : "Thinking…"}
          </Text>
        </View>
      )}
      {!!message.body && <Markdown text={message.body} />}
      {message.status === "failed" && (
        <Text style={[styles.error, { color: t.danger }]}>
          {message.error ?? "This answer failed."}
        </Text>
      )}
      {message.status === "cancelled" && (
        <Text style={[styles.time, { color: t.muted }]}>Stopped</Text>
      )}
      {!!message.changes?.length && (
        <ChangedFiles
          files={message.changes}
          onOpen={(file) => onOpenFile(file, message.id)}
        />
      )}
    </View>
  );
}

function ActivitySummary({
  calls,
  commentary,
  took,
}: {
  calls: AgentActivity[];
  commentary: string[];
  took?: string;
}) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  const Icon = icons[calls[0]!.kind];
  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen(!open)}
        style={styles.summary}
        hitSlop={6}
      >
        <Icon size={15} color={t.muted} />
        <Text style={[styles.summaryText, { color: t.muted }]}>
          {summarizeActivity(calls)}
          {took ? `  ${took}` : ""}
        </Text>
        {open ? (
          <ChevronDown size={14} color={t.faint} />
        ) : (
          <ChevronRight size={14} color={t.faint} />
        )}
      </Pressable>
      {open && (
        <View style={[styles.calls, { borderColor: t.border }]}>
          {calls.map((a) => {
            const CallIcon = icons[a.kind];
            return (
              <View key={a.id} style={styles.call}>
                <CallIcon
                  size={13}
                  color={a.status === "failed" ? t.danger : t.faint}
                />
                <Text
                  numberOfLines={2}
                  style={[
                    styles.callText,
                    { color: a.status === "failed" ? t.danger : t.muted },
                  ]}
                >
                  {a.kind === "command" ? a.label : doneLabel(a)}
                </Text>
              </View>
            );
          })}
          {commentary.map((text, i) => (
            <Text key={i} style={[styles.commentary, { color: t.muted }]}>
              {text}
            </Text>
          ))}
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
  header: { flexDirection: "row", alignItems: "center", gap: 7 },
  author: { fontSize: type.small, fontWeight: "600" },
  time: { fontSize: type.tiny },
  userBody: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  pending: { opacity: 0.6 },
  userText: { fontSize: type.body, lineHeight: 22 },
  live: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 22 },
  liveText: { fontSize: type.small, flex: 1 },
  summary: { flexDirection: "row", alignItems: "center", gap: 7, minHeight: 22 },
  summaryText: { fontSize: type.small, flexShrink: 1 },
  calls: {
    marginTop: 6,
    marginLeft: 7,
    paddingLeft: 12,
    borderLeftWidth: StyleSheet.hairlineWidth,
    gap: 6,
  },
  call: { flexDirection: "row", alignItems: "flex-start", gap: 7 },
  callText: { fontSize: type.tiny, fontFamily: mono, flex: 1, lineHeight: 17 },
  commentary: { fontSize: type.tiny, fontStyle: "italic", lineHeight: 17 },
  error: { fontSize: type.small, lineHeight: 19 },
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
