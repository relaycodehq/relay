// The desktop's subagents indicator and card (src/features/agent-turn/Subagents.tsx)
// for a phone: a still line over the composer while a fan-out works, and a
// sheet listing its agents with Stop on the running ones.
import { useRef, useState } from "react";
import { Alert, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { Bot, Check, ChevronUp, CircleStop, CircleX } from "lucide-react-native";
import { plural } from "../../../shared/activity-labels";
import {
  agentKind,
  modelName,
  subagentNow,
  took,
  type SubagentRun,
} from "../../../shared/subagents";
import { useNow } from "./motion";
import { Sheet } from "./Sheet";
import { Action } from "./ThreadExtras";
import { type, useTheme } from "./theme";

/**
 * Still, even while it works: the turn's running row is what moves. The
 * ticking time beside it says it's alive.
 */
export function SubagentMark({ run }: { run: SubagentRun }) {
  const t = useTheme();
  if (run.status === "running")
    return (
      <View accessibilityLabel="Working" style={styles.markBox}>
        <View style={[styles.dot, { backgroundColor: t.accent }]} />
      </View>
    );
  const Icon =
    run.status === "completed" ? Check : run.status === "failed" ? CircleX : CircleStop;
  return (
    <View
      accessibilityLabel={
        run.status === "completed" ? "Done" : run.status === "failed" ? "Failed" : "Stopped"
      }
      style={styles.markBox}
    >
      <Icon size={14} color={run.status === "completed" ? t.additionText : t.muted} />
    </View>
  );
}

/** Asks before stopping one: the turn and the other agents carry on. */
export function confirmStop(run: SubagentRun, stop: () => Promise<void>) {
  return new Promise<void>((done) =>
    Alert.alert(
      "Stop this agent?",
      `“${run.description}” stops where it is. Claude hears it was stopped and carries on; the rest keep working.`,
      [
        { text: "Keep it", style: "cancel", onPress: () => done() },
        {
          text: "Stop agent",
          style: "destructive",
          onPress: () =>
            void stop()
              .catch((e) =>
                Alert.alert("Couldn't stop it", e instanceof Error ? e.message : String(e)),
              )
              .finally(done),
        },
      ],
      { cancelable: true, onDismiss: () => done() },
    ),
  );
}

/**
 * One line over the composer while a fan-out works: how many are out, how
 * many are back, and what the newest working one is on. It's the same
 * height whatever it says, so the thread above doesn't move as calls come
 * and go.
 */
export function SubagentStrip({
  batch,
  display,
  onPress,
}: {
  batch: SubagentRun[];
  display: (text: string) => string;
  onPress: () => void;
}) {
  const t = useTheme();
  const working = batch.filter((r) => r.status === "running");
  const latest = working.reduce<SubagentRun | undefined>(
    (a, r) => (!a || r.started >= a.started ? r : a),
    undefined,
  );
  if (!latest) return null;
  const back = batch.length - working.length;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${plural(batch.length, "subagent")}: ${back} back, ${working.length} working`}
      accessibilityHint="Lists them, to read one's run or stop it"
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => [
        styles.strip,
        { borderColor: t.border, backgroundColor: pressed ? t.hover : t.raised },
      ]}
    >
      <Bot size={15} color={t.muted} />
      <Text numberOfLines={1} style={[styles.stripText, { color: t.text }]}>
        {working.length === 1 ? "1 agent working" : `${working.length} agents working`}
        <Text style={{ color: t.muted }}>
          {" · "}
          {latest.description}: {subagentNow(latest, display)}
        </Text>
      </Text>
      {batch.length > 1 && (
        <Text style={[styles.count, { color: t.muted }]}>
          {back}/{batch.length}
        </Text>
      )}
      <ChevronUp size={16} color={t.muted} />
    </Pressable>
  );
}

/**
 * The fan-out's agents, kept in the sheet as they come back. A row opens
 * that agent's run; Stop asks first.
 */
export function SubagentsSheet({
  open,
  batch,
  runs,
  display,
  onClose,
  onOpen,
  onStop,
}: {
  open: boolean;
  /** The fan-out the strip showed; the sheet holds on to it once it's all back. */
  batch: SubagentRun[];
  /** Every agent the thread knows of, for their latest state. */
  runs: SubagentRun[];
  display: (text: string) => string;
  onClose: () => void;
  onOpen: (id: string) => void;
  onStop: (id: string) => Promise<void>;
}) {
  const t = useTheme();
  const [ids, setIds] = useState<string[]>([]);
  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setIds(batch.map((r) => r.id));
  }
  // New agents of the same fan-out join while it's open.
  const fresh = batch.filter((r) => !ids.includes(r.id)).map((r) => r.id);
  if (open && fresh.length) setIds([...ids, ...fresh]);
  const shown = ids.flatMap((id) => runs.find((r) => r.id === id) ?? []);
  const back = shown.filter((r) => r.status !== "running").length;
  // iOS won't push a screen while the sheet is still leaving.
  const picked = useRef<string>(undefined);
  const openRun = () => {
    const id = picked.current;
    picked.current = undefined;
    if (id) onOpen(id);
  };
  return (
    <Sheet
      open={open}
      title={`Subagents · ${back} of ${shown.length} back`}
      onClose={onClose}
      onDismiss={openRun}
    >
      {shown.map((run) => (
        <Row
          key={run.id}
          run={run}
          display={display}
          onPress={() => {
            picked.current = run.id;
            onClose();
            if (Platform.OS !== "ios") openRun();
          }}
          onStop={() => confirmStop(run, () => onStop(run.id))}
        />
      ))}
      <Text style={[styles.foot, { color: t.muted }]}>
        Stopping one leaves Claude&apos;s turn and the other agents running.
      </Text>
    </Sheet>
  );
}

function Row({
  run,
  display,
  onPress,
  onStop,
}: {
  run: SubagentRun;
  display: (text: string) => string;
  onPress: () => void;
  onStop: () => Promise<void>;
}) {
  const t = useTheme();
  const now = useNow(1000);
  const about = [agentKind(run), run.model && modelName(run.model), plural(run.calls, "call")]
    .filter(Boolean)
    .join(" · ");
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityHint="Opens its run"
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: t.hover }]}
    >
      <SubagentMark run={run} />
      <View style={styles.rowText}>
        <View style={styles.rowHead}>
          <Text numberOfLines={1} style={[styles.name, { color: t.text }]}>
            {run.description}
          </Text>
          <Text style={[styles.time, { color: t.muted }]}>
            {took((run.ended ?? now) - run.started)}
          </Text>
        </View>
        <Text numberOfLines={2} style={[styles.now, { color: t.muted }]}>
          {subagentNow(run, display)}
        </Text>
        <Text numberOfLines={1} style={[styles.about, { color: t.faint }]}>
          {about}
        </Text>
      </View>
      {run.status === "running" && (
        <Action label="Stop" busyLabel="Stopping…" onPress={onStop} />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  strip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginHorizontal: 12,
    marginBottom: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: 10,
    height: 40,
  },
  stripText: { flex: 1, fontSize: type.small },
  count: { fontSize: type.small, fontVariant: ["tabular-nums"] },
  markBox: { width: 16, alignItems: "center", justifyContent: "center" },
  dot: { width: 7, height: 7, borderRadius: 3.5 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  rowText: { flex: 1, gap: 2 },
  rowHead: { flexDirection: "row", alignItems: "baseline", gap: 8 },
  name: { flex: 1, fontSize: type.body, fontWeight: "500" },
  time: { fontSize: type.tiny, fontVariant: ["tabular-nums"] },
  now: { fontSize: type.small, lineHeight: 18 },
  about: { fontSize: type.tiny },
  foot: { fontSize: type.tiny, paddingHorizontal: 20, paddingTop: 6, paddingBottom: 12 },
});
