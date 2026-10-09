// The desktop's subagents indicator and card (src/features/agent-turn/Subagents.tsx)
// for a phone: a still line over the composer while a fan-out works, and a
// sheet listing its agents with Stop on the running ones.
import { useRef, useState } from "react";
import { Alert, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { Bot, Check, ChevronUp, CircleStop, CircleX } from "lucide-react-native";
import { plural } from "../../../shared/activity-labels";
import type { RemoteChatSummary } from "../../../shared/remote";
import { slotLine } from "../../../shared/started-threads";
import {
  agentKind,
  modelName,
  subagentNow,
  took,
  type SubagentRun,
} from "../../../shared/subagents";
import { alertFailure } from "./failure";
import { useNow } from "./motion";
import { Sheet } from "./Sheet";
import { FamilyMark, StartedList } from "./StartedThreads";
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
export function confirmStop(run: SubagentRun) {
  return new Promise<boolean>((answer) =>
    Alert.alert(
      "Stop this agent?",
      `“${run.description}” stops where it is. Claude hears it was stopped and carries on; the rest keep working.`,
      [
        { text: "Keep it", style: "cancel", onPress: () => answer(false) },
        { text: "Stop agent", style: "destructive", onPress: () => answer(true) },
      ],
      { cancelable: true, onDismiss: () => answer(false) },
    ),
  );
}

/** Stops it, saying so when it couldn't. */
export const stopping = (stop: () => Promise<void>) => () =>
  stop().catch((e) =>
    alertFailure(
      e,
      e instanceof Error && /already finished/i.test(e.message)
        ? "Agent already finished"
        : "Couldn't stop it",
      "Stop may still go through",
    ),
  );

/**
 * One line over the composer while a fan-out works: how many are out, how
 * many are back, and what the newest working one is on. It's the same
 * height whatever it says, so the thread above doesn't move as calls come
 * and go. An idle thread with no agents out gives the screen back. Threads
 * the thread's agent started share the line: never two strips.
 */
export function SubagentStrip({
  batch,
  reserve,
  display,
  onPress,
  error,
  onRetry,
  started,
}: {
  /** The started threads to tell of, while any works or asks. */
  started: RemoteChatSummary[];
  /** Holds its height with no agents out, e.g. while a turn runs that may send some. */
  reserve: boolean;
  error?: string;
  onRetry: () => Promise<unknown>;
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
  if (started.length) {
    const line = slotLine(started, working.length);
    return (
      <View style={styles.slot}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={line}
          accessibilityHint="Lists them, to open one"
          onPress={onPress}
          hitSlop={4}
          style={({ pressed }) => [
            styles.strip,
            { borderColor: t.border, backgroundColor: pressed ? t.hover : t.raised },
          ]}
        >
          <FamilyMark started={started} />
          <Text numberOfLines={1} style={[styles.stripText, { color: t.text }]}>
            {line}
          </Text>
          <ChevronUp size={16} color={t.muted} />
        </Pressable>
      </View>
    );
  }
  if (!latest) {
    if (!reserve && !error) return null;
    return (
      <View style={styles.slot}>
        {error && (
          <Pressable
            onPress={() => void onRetry()}
            style={styles.retry}
            accessibilityRole="button"
          >
            <Text
              numberOfLines={1}
              style={[styles.stripText, { color: t.muted }]}
            >
              Couldn&apos;t load agents · Retry
            </Text>
          </Pressable>
        )}
      </View>
    );
  }
  const back = batch.length - working.length;
  return (
    <View style={styles.slot}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${plural(batch.length, "subagent")}: ${back} back, ${working.length} working`}
        accessibilityHint="Lists them, to read one's run or stop it"
        onPress={onPress}
        hitSlop={4}
        style={({ pressed }) => [
          styles.strip,
          {
            borderColor: t.border,
            backgroundColor: pressed ? t.hover : t.raised,
          },
        ]}
      >
        <Bot size={15} color={t.muted} />
        <Text numberOfLines={1} style={[styles.stripText, { color: t.text }]}>
          {working.length === 1
            ? "1 agent working"
            : `${working.length} agents working`}
          <Text style={{ color: t.muted }}>
            {" · "}
            {/* What it's doing says more than its name on a phone's width; the sheet has both. */}
            {error
              ? "Updates paused · open for details"
              : latest.summary ||
                  latest.recent.some((c) => c.status === "running")
                ? subagentNow(latest, display)
                : latest.description}
          </Text>
        </Text>
        {batch.length > 1 && (
          <Text style={[styles.count, { color: t.muted }]}>
            {back}/{batch.length}
          </Text>
        )}
        <ChevronUp size={16} color={t.muted} />
      </Pressable>
    </View>
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
  error,
  onRetry,
  started,
  onOpenThread,
}: {
  error?: string;
  onRetry: () => Promise<unknown>;
  open: boolean;
  /** The thread's started threads, listed too when the strip told of them as it opened. */
  started: { family: RemoteChatSummary[]; shown: boolean };
  onOpenThread: (id: string) => void;
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
  const [withStarted, setWithStarted] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setIds(batch.map((r) => r.id));
      setWithStarted(started.shown);
    }
  }
  // New agents of the same fan-out join while it's open.
  const fresh = batch.filter((r) => !ids.includes(r.id)).map((r) => r.id);
  if (open && fresh.length) setIds([...ids, ...fresh]);
  const shown = ids.flatMap((id) => runs.find((r) => r.id === id) ?? []);
  const back = shown.filter((r) => r.status !== "running").length;
  const family = withStarted ? started.family : [];
  // iOS won't push a screen while the sheet is still leaving.
  const picked = useRef<{ thread?: string; run?: string }>(undefined);
  const openRun = () => {
    const { thread, run } = picked.current ?? {};
    picked.current = undefined;
    if (run) onOpen(run);
    if (thread) onOpenThread(thread);
  };
  const pick = (which: { thread?: string; run?: string }) => {
    picked.current = which;
    onClose();
    if (Platform.OS !== "ios") openRun();
  };
  const both = family.length > 0 && shown.length > 0;
  const working = shown.filter((r) => r.status === "running").length;
  return (
    <Sheet
      open={open}
      title={
        both
          ? slotLine(family, working)
          : family.length
            ? ["Started threads", ...slotLine(family).split(" · ").slice(1)].join(" · ")
            : `Subagents · ${back} of ${shown.length} back`
      }
      onClose={onClose}
      onDismiss={openRun}
    >
      {both && <Section label={`Subagents · ${back} of ${shown.length} back`} />}
      {error && (
        <View style={styles.retry}>
          <Text style={[styles.now, { color: t.muted }]}>{error}</Text>
          <Action
            label="Retry"
            onPress={async () => {
              await onRetry();
            }}
          />
        </View>
      )}
      {shown.map((run) => (
        <Row
          key={run.id}
          run={run}
          display={display}
          onPress={() => pick({ run: run.id })}
          onStop={() => onStop(run.id)}
        />
      ))}
      {shown.length > 0 && (
        <Text style={[styles.foot, { color: t.muted }]}>
          Stopping one leaves Claude&apos;s turn and the other agents running.
        </Text>
      )}
      {both && <Section label="Started threads" />}
      <StartedList started={family} onOpen={(thread) => pick({ thread })} />
    </Sheet>
  );
}

function Section({ label }: { label: string }) {
  const t = useTheme();
  return <Text style={[styles.section, { color: t.muted }]}>{label}</Text>;
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
        <Action
          label="Stop"
          busyLabel="Stopping…"
          confirm={() => confirmStop(run)}
          onPress={stopping(onStop)}
        />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  slot: { height: 48 },
  retry: {
    marginHorizontal: 20,
    minHeight: 40,
    justifyContent: "center",
    gap: 8,
  },
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
  section: { fontSize: type.tiny, fontWeight: "600", paddingHorizontal: 20, paddingTop: 8, paddingBottom: 2 },
  foot: { fontSize: type.tiny, paddingHorizontal: 20, paddingTop: 6, paddingBottom: 12 },
});
