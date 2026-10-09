// CI on the thread's branch, as the desktop's thread header shows it: one
// mark for the overall state, and the runs behind it a tap away.
import { useCallback, useEffect, useRef, useState } from "react";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { useFocusEffect } from "expo-router";
import {
  CircleCheck,
  CircleDashed,
  CircleX,
  ExternalLink,
} from "lucide-react-native";
import { ciSummary, type CiState, type CiStatus } from "../../../shared/ci";
import { shortAge } from "../../../shared/chat-activity";
import { useRemote } from "../remote/RemoteProvider";
import { useForeground, useNow } from "./motion";
import { Sheet } from "./Sheet";
import { type, useTheme, type Palette } from "./theme";

const label: Record<CiState, string> = {
  success: "CI passed",
  failure: "CI failed",
  running: "CI running",
  skipped: "CI skipped",
};

function Mark({
  state,
  t,
  size = 20,
}: {
  state: CiState;
  t: Palette;
  size?: number;
}) {
  if (state === "success")
    return <CircleCheck size={size} color={t.additionText} />;
  if (state === "failure") return <CircleX size={size} color={t.danger} />;
  // Still, not spinning: the header stays calm while an agent works.
  return (
    <CircleDashed
      size={size}
      color={state === "running" ? t.accent : t.muted}
    />
  );
}

export function CiStatusButton({
  projectId,
  chatId,
  running,
}: {
  projectId: string;
  chatId: string;
  /** The agent is working; it may push, so its end looks again. */
  running: boolean;
}) {
  const t = useTheme();
  const { desktop, status } = useRemote();
  const [ci, setCi] = useState<CiStatus | null>(null);
  const [open, setOpen] = useState(false);
  const now = useNow(60_000);
  const foreground = useForeground();
  const load = useCallback(() => {
    if (status !== "online") return;
    desktop("projectCiStatus", projectId, chatId)
      .then(setCi)
      .catch(() => setCi(null));
  }, [desktop, status, projectId, chatId]);
  // Now and every minute while this thread is on screen and the app in front.
  useFocusEffect(
    useCallback(() => {
      if (!foreground) return;
      load();
      const timer = setInterval(load, 60_000);
      return () => clearInterval(timer);
    }, [load, foreground]),
  );
  const wasRunning = useRef(running);
  useEffect(() => {
    if (wasRunning.current && !running) load();
    wasRunning.current = running;
  }, [running, load]);

  const summary = ci ? ciSummary(ci.runs) : null;
  if (!ci || !summary) return null;
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label[summary.state]} on ${ci.branch}`}
        hitSlop={10}
        onPress={() => setOpen(true)}
        style={styles.button}
      >
        <Mark state={summary.state} t={t} />
      </Pressable>
      <Sheet
        open={open}
        title={`CI on ${ci.branch}`}
        onClose={() => setOpen(false)}
      >
        {!!ci.commit.message && (
          <Text numberOfLines={2} style={[styles.commit, { color: t.muted }]}>
            {ci.commit.sha.slice(0, 7)} · {ci.commit.message.split("\n")[0]}
          </Text>
        )}
        {ci.ahead > 0 && (
          <Text style={[styles.commit, { color: t.muted }]}>
            {ci.ahead === 1
              ? "1 newer commit hasn’t"
              : `${ci.ahead} newer commits haven’t`}{" "}
            run yet.
          </Text>
        )}
        {ci.runs.map((run) => (
          <Pressable
            key={`${run.workflow}-${run.url}`}
            accessibilityRole="link"
            accessibilityLabel={`${run.workflow}, ${label[run.state]}`}
            onPress={() => void Linking.openURL(run.url)}
            style={({ pressed }) => [
              styles.run,
              pressed && { backgroundColor: t.hover },
            ]}
          >
            <Mark state={run.state} t={t} size={17} />
            <View style={styles.runText}>
              <Text
                numberOfLines={1}
                style={[styles.workflow, { color: t.text }]}
              >
                {run.workflow}
              </Text>
              <Text numberOfLines={1} style={[styles.meta, { color: t.muted }]}>
                {run.failedJob ? `${run.failedJob} failed · ` : ""}
                {shortAge(run.at, now)}
              </Text>
            </View>
            <ExternalLink size={15} color={t.muted} />
          </Pressable>
        ))}
      </Sheet>
    </>
  );
}

const styles = StyleSheet.create({
  button: { marginRight: 18 },
  commit: {
    fontSize: type.small,
    lineHeight: 19,
    paddingHorizontal: 20,
    paddingBottom: 8,
  },
  run: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 52,
    paddingHorizontal: 20,
  },
  runText: { flex: 1, gap: 2 },
  workflow: { fontSize: type.body },
  meta: { fontSize: type.tiny },
});
