// The desktop's WatchNotes (src/features/watch): what the side check flagged
// in a turn, as a quiet card after the answer. Closing one, any of the three
// ways, keeps it out of the turn.
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Eye, X } from "lucide-react-native";
import type { WatchClose, WatchNote } from "../../../shared/watch";
import { awayBridge } from "../../../shared/remote";
import { useRemote } from "../remote/RemoteProvider";
import { Markdown, type OpenLink } from "./Markdown";
import { mono, type, useTheme } from "./theme";

export function WatchNotes({
  chatId,
  messageId,
  notes,
  agent,
  onLink,
  onSteer,
}: {
  chatId: string;
  messageId: string;
  notes: WatchNote[] | undefined;
  /** Who Tell puts the message in front of. */
  agent: string;
  onLink: OpenLink;
  /** Puts a message for the agent in the composer. */
  onSteer?: (text: string) => void;
}) {
  const t = useTheme();
  const { desktop, overview } = useRemote();
  const [open, setOpen] = useState<string | null>(null);
  // Hidden at once; the thread's copy catches up when the close lands.
  const [closed, setClosed] = useState<string[]>([]);
  const shown = notes?.filter((n) => !n.closed && !closed.includes(n.id));
  if (!shown?.length) return null;
  // Older desktops can't take a close from a phone; the notes still read.
  const closable = (overview?.bridge ?? 1) >= awayBridge;
  const close = (note: WatchNote, how: WatchClose) => {
    setClosed((all) => [...all, note.id]);
    void desktop("closeWatchNote", chatId, messageId, note.id, how, open === note.id).catch(() =>
      setClosed((all) => all.filter((id) => id !== note.id)),
    );
  };
  return shown.map((note) => {
    const reading = open === note.id;
    return (
      <View
        key={note.id}
        accessibilityLabel={note.tag}
        style={[styles.note, { borderColor: t.border, backgroundColor: t.toolbar }]}
      >
        <View style={styles.header}>
          <Eye size={13} color={t.muted} />
          <Text style={[styles.tag, { color: t.text }]}>{note.tag}</Text>
          <Text numberOfLines={1} style={[styles.source, { color: t.muted }]}>
            {note.agent ? `subagent · ${note.agent.label}` : "this turn"}
          </Text>
          {closable && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Dismiss"
              hitSlop={10}
              onPress={() => close(note, "dismissed")}
            >
              <X size={15} color={t.muted} />
            </Pressable>
          )}
        </View>
        <Text style={[styles.line, { color: t.text }]}>{note.line}</Text>
        {reading && (
          <View style={styles.explain}>
            <Text style={[styles.title, { color: t.text }]}>{note.title}</Text>
            {!!note.points.length && (
              <Markdown small text={note.points.map((p) => `- ${p}`).join("\n")} onLink={onLink} />
            )}
            {note.diff && (
              <View style={[styles.diff, { backgroundColor: t.code }]}>
                <Text style={[styles.file, { color: t.muted }]}>{note.diff.file}</Text>
                {note.diff.lines.map((line, i) => (
                  <Text
                    key={i}
                    style={[
                      styles.diffLine,
                      { color: t.text },
                      line[0] === "+" && { backgroundColor: t.addition },
                      line[0] === "-" && { backgroundColor: t.deletion },
                    ]}
                  >
                    {line}
                  </Text>
                ))}
              </View>
            )}
          </View>
        )}
        <View style={styles.actions}>
          <NoteAction label={reading ? "Less" : "Learn more"} onPress={() => setOpen(reading ? null : note.id)} />
          {onSteer && (
            <NoteAction
              label={`Tell ${agent}`}
              onPress={() => {
                onSteer(note.steer ?? `About this: ${note.line}`);
                if (closable) close(note, "told");
              }}
            />
          )}
          {closable && <NoteAction label="I know this" onPress={() => close(note, "known")} />}
        </View>
      </View>
    );
  });
}

function NoteAction({ label, onPress }: { label: string; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable accessibilityRole="button" hitSlop={6} onPress={onPress} style={styles.action}>
      <Text style={[styles.actionText, { color: t.muted }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  note: {
    marginTop: 12,
    paddingTop: 10,
    paddingBottom: 4,
    paddingHorizontal: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
  },
  header: { flexDirection: "row", alignItems: "center", gap: 7, marginBottom: 4 },
  tag: { fontSize: type.small, fontWeight: "600" },
  source: { flex: 1, fontSize: type.tiny },
  line: { fontSize: type.small, lineHeight: 20 },
  explain: { marginTop: 10, gap: 6 },
  title: { fontSize: type.small, fontWeight: "600" },
  diff: { marginTop: 4, padding: 8, borderRadius: 8 },
  file: { fontSize: type.tiny, marginBottom: 4 },
  diffLine: { fontFamily: mono, fontSize: 12, lineHeight: 19 },
  actions: { flexDirection: "row", marginLeft: -8, marginTop: 2 },
  action: { paddingHorizontal: 8, paddingVertical: 8 },
  actionText: { fontSize: type.small, fontWeight: "500" },
});
