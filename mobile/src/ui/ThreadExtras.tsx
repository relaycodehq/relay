// What docks above the composer on the desktop (WaitingStrip, StoppedStrip,
// the queue), worded the same, with the phone's thumb-sized actions.
import { useRef, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import {
  AlarmClock,
  ChevronDown,
  ChevronUp,
  CircleStop,
  Hourglass,
  SquareTerminal,
  Target,
  X,
} from "lucide-react-native";
import { presentGoal, type ThreadGoal } from "../../../shared/goal";
import { wakeLabel } from "../../../shared/chat-activity";
import { summary, timing, wakeupTitle } from "../../../shared/waiting";
import type { ChatPending, LimitResume } from "../../../shared/projects";
import type { Outgoing } from "../remote/outbox";
import type { RemoteQueued } from "../../../shared/remote";
import { agentNames } from "./ProviderIcon";
import { MenuSheet } from "./Sheet";
import { withoutMention } from "../../../shared/remote-compose";
import { useTick } from "./motion";
import { type, useTheme } from "./theme";

/** "Run the A/B" reads as "…waiting on run the A/B"; acronyms keep their case. */
const lower = (text: string) =>
  /^[A-Z][a-z]/.test(text) ? text[0]!.toLowerCase() + text.slice(1) : text;

/** A row in the list: the command itself, or when Claude checks back. */
const what = (item: ChatPending) =>
  item.kind === "task" ? item.description : wakeupTitle(item);

/**
 * Work Claude left running that will start its next turn by itself. More than
 * one folds into a line that opens to the list, so a few servers don't push
 * the thread off the screen.
 */
export function WaitingStrip({
  pending,
  onStop,
}: {
  pending: ChatPending[];
  onStop: (item: ChatPending) => Promise<void>;
}) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  useTick(1000);
  const now = Date.now();
  const [first] = pending;
  if (!first) return null;
  const head = summary(pending, now);
  const icon = (item: ChatPending) =>
    item.kind === "task" ? (
      <SquareTerminal size={15} color={t.muted} />
    ) : (
      <AlarmClock size={15} color={t.muted} />
    );
  const stop = (item: ChatPending) => (
    <Action
      label={item.kind === "task" ? "Stop" : "Cancel"}
      busyLabel={item.kind === "task" ? "Stopping…" : "Cancelling…"}
      onPress={() => onStop(item)}
    />
  );
  const line = (
    <Text numberOfLines={2} style={[styles.text, { color: t.text }]}>
      {head.title}
      <Text style={{ color: t.muted }}>{head.detail}</Text>
    </Text>
  );
  const strip = [
    styles.strip,
    { borderColor: t.border, backgroundColor: t.raised },
  ];
  if (pending.length === 1)
    return (
      <View style={strip}>
        <View style={styles.item}>
          {icon(first)}
          {line}
          {stop(first)}
        </View>
      </View>
    );
  const Chevron = open ? ChevronUp : ChevronDown;
  return (
    <View style={strip}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityHint={open ? "Hides the list" : "Shows each one with Stop"}
        onPress={() => setOpen((o) => !o)}
        hitSlop={6}
        style={styles.item}
      >
        {icon(first)}
        {line}
        <Chevron size={16} color={t.muted} />
      </Pressable>
      {open &&
        pending.map((item) => {
          const when = timing(item, now);
          return (
            <View key={item.id} style={styles.item}>
              {icon(item)}
              <Text numberOfLines={2} style={[styles.text, { color: t.text }]}>
                {what(item)}
                {when && <Text style={{ color: t.muted }}> · {when}</Text>}
              </Text>
              {stop(item)}
            </View>
          );
        })}
    </View>
  );
}

/**
 * The thread's native `/goal`, as the desktop's row shows it. `/goal pause`,
 * `resume` and `clear` typed here act on it.
 */
export function GoalStrip({
  goal,
  running,
}: {
  goal: ThreadGoal;
  running: boolean;
}) {
  const t = useTheme();
  const shown = presentGoal(goal, running);
  return (
    <View
      style={[
        styles.strip,
        { borderColor: t.border, backgroundColor: t.raised },
      ]}
    >
      <View style={styles.item}>
        <Target size={15} color={shown.working ? t.accent : t.muted} />
        <Text numberOfLines={3} style={[styles.text, { color: t.text }]}>
          {shown.title}
          <Text style={{ color: t.muted }}>
            {" · "}
            {shown.objective}
            {shown.usage ? ` · ${shown.usage}` : ""}
          </Text>
        </Text>
      </View>
      {shown.detail ? (
        <Text numberOfLines={2} style={[styles.hint, { color: t.muted }]}>
          {shown.detail}
        </Text>
      ) : null}
    </View>
  );
}

/** Work that ended when Relay closed, until picked back up or dismissed. */
export function StoppedStrip({
  items,
  onResolve,
}: {
  items: ChatPending[];
  onResolve: (action: "resume" | "dismiss") => Promise<void>;
}) {
  const t = useTheme();
  const [first] = items;
  if (!first) return null;
  return (
    <View
      style={[
        styles.strip,
        { borderColor: t.border, backgroundColor: t.raised },
      ]}
    >
      <View style={styles.item}>
        <CircleStop size={15} color={t.muted} />
        <Text style={[styles.text, { color: t.text }]}>
          Relay closed while Claude was waiting on{" "}
          {first.kind === "task"
            ? lower(first.description)
            : "a recurring wake-up"}
          <Text style={{ color: t.muted }}>
            {items.length > 1 ? ` · +${items.length - 1} more` : ""} · it
            stopped
          </Text>
        </Text>
      </View>
      <View style={styles.actions}>
        <Action label="Dismiss" onPress={() => onResolve("dismiss")} />
        <Action
          label="Pick it back up"
          primary
          onPress={() => onResolve("resume")}
        />
      </View>
    </View>
  );
}

/** A usage limit stopped the answer; the desktop carries it on once the limit lifts. */
export function LimitStrip({
  plan,
  onSet,
}: {
  plan: LimitResume;
  onSet: (on: boolean) => Promise<void>;
}) {
  const t = useTheme();
  useTick(30_000);
  const now = new Date();
  const due = plan.at <= now.getTime();
  // Off with the limit lifted, Resume answer in the thread does the same.
  if (plan.off && due) return null;
  return (
    <View
      style={[
        styles.strip,
        { borderColor: t.border, backgroundColor: t.raised },
      ]}
    >
      <View style={styles.item}>
        <Hourglass size={15} color={t.muted} />
        <Text style={[styles.text, { color: t.text }]}>
          {agentNames[plan.provider]} hit its usage limit
          <Text style={{ color: t.muted }}>
            {plan.off
              ? ` · resets ${wakeLabel(plan.at, now)}`
              : due
                ? " · resuming the answer"
                : ` · resumes the answer at ${wakeLabel(plan.at, now)}`}
          </Text>
        </Text>
      </View>
      <View style={styles.actions}>
        {plan.off ? (
          <Action label="Resume then" primary onPress={() => onSet(true)} />
        ) : (
          <Action label="Don't resume" onPress={() => onSet(false)} />
        )}
      </View>
    </View>
  );
}

type Waiting = RemoteQueued & { at?: number };

/**
 * Messages waiting for their own turn, and those sent with Send later. Send
 * one now (steering it into a running answer), take it back to edit, or hold
 * it to move or delete it, as in the desktop's queue.
 */
export function QueueList({
  queue,
  scheduled,
  running,
  compacting,
  paused,
  onSteer,
  onEdit,
  onRemove,
  onMove,
}: {
  queue: Waiting[];
  scheduled: Waiting[];
  running: boolean;
  /** The running turn compacts the session: nothing steers it, the queue goes once it's done. */
  compacting?: boolean;
  paused?: boolean;
  onSteer: (id: string) => Promise<void>;
  onEdit: (item: Waiting) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
  onMove: (id: string, index: number) => Promise<void>;
}) {
  const t = useTheme();
  const [holding, setHolding] = useState<{ item: Waiting; index: number }>();
  if (!queue.length && !scheduled.length) return null;
  const row = (item: Waiting, index: number, later: boolean) => (
    <Pressable
      key={item.id}
      // Hold for more; its own buttons stay separate for screen readers.
      accessible={false}
      onLongPress={later ? undefined : () => setHolding({ item, index })}
      style={[
        styles.queued,
        { borderColor: t.border, backgroundColor: t.background },
      ]}
    >
      <View style={styles.queuedText}>
        <Text numberOfLines={2} style={[styles.text, { color: t.text }]}>
          {withoutMention(item.body)}
        </Text>
        <Text style={[styles.hint, { color: item.error ? t.danger : t.muted }]}>
          {item.error ??
            [
              later && item.at
                ? `Sends ${wakeLabel(item.at, new Date())}`
                : index === 0 && !paused
                  ? compacting
                    ? "Sends after compaction"
                    : "Next"
                  : "Queued",
              item.images
                ? `${item.images} ${item.images === 1 ? "image" : "images"}`
                : "",
            ]
              .filter(Boolean)
              .join(" · ")}
        </Text>
      </View>
      <Action
        label={compacting ? "Send next" : running ? "Steer now" : "Send now"}
        onPress={() => onSteer(item.id)}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Cancel and return to the composer"
        hitSlop={10}
        onPress={() => void onEdit(item)}
      >
        <X size={16} color={t.muted} />
      </Pressable>
    </Pressable>
  );
  return (
    <View style={styles.queue} accessibilityLabel="Queued messages">
      {paused && !!queue.length && (
        <Text style={[styles.hint, { color: t.muted }]}>
          Queue paused. Send one now to carry on.
        </Text>
      )}
      {queue.map((q, i) => row(q, i, false))}
      {scheduled.map((q, i) => row(q, i, true))}
      <MenuSheet
        open={!!holding}
        title={
          holding ? withoutMention(holding.item.body).slice(0, 60) : undefined
        }
        onClose={() => setHolding(undefined)}
        items={
          holding
            ? [
                ...(holding.index > 0
                  ? [
                      {
                        label: "Move up",
                        onPress: () =>
                          void onMove(holding.item.id, holding.index - 1),
                      },
                    ]
                  : []),
                ...(holding.index < queue.length - 1
                  ? [
                      {
                        label: "Move down",
                        onPress: () =>
                          void onMove(holding.item.id, holding.index + 1),
                      },
                    ]
                  : []),
                {
                  label: "Edit",
                  hint: "Back to the composer, out of the queue.",
                  onPress: () => void onEdit(holding.item),
                },
                {
                  label: "Delete",
                  destructive: true,
                  onPress: () => void onRemove(holding.item.id),
                },
              ]
            : []
        }
      />
    </View>
  );
}

/** Messages the desktop didn't take: send again, or back into the composer. */
export function UnsentStrip({
  unsent,
  onRetry,
  onEdit,
}: {
  unsent: Outgoing[];
  onRetry: (o: Outgoing) => void;
  onEdit: (o: Outgoing) => void;
}) {
  const t = useTheme();
  if (!unsent.length) return null;
  return (
    <View style={[styles.strip, { borderColor: t.border, backgroundColor: t.raised }]}>
      {unsent.map((o) => (
        <View key={o.send.id} style={styles.item}>
          <Text numberOfLines={1} style={[styles.text, { color: t.text }]}>
            {withoutMention(o.send.body)}
          </Text>
          <Action label="Edit" onPress={async () => onEdit(o)} />
          <Action label="Try again" primary onPress={async () => onRetry(o)} />
        </View>
      ))}
    </View>
  );
}

/** A small text action that stays pressed until its work is done. */
export function Action({
  label,
  busyLabel,
  primary,
  confirm,
  onPress,
}: {
  label: string;
  busyLabel?: string;
  primary?: boolean;
  /** Asked first; the button only turns busy once it says yes. */
  confirm?: () => Promise<boolean>;
  onPress: () => Promise<void>;
}) {
  const t = useTheme();
  const [busy, setBusy] = useState(false);
  const claimed = useRef(false);
  return (
    <Pressable
      accessibilityRole="button"
      disabled={busy}
      hitSlop={8}
      onPress={() =>
        void (async () => {
          if (claimed.current) return;
          claimed.current = true;
          try {
            if (confirm && !(await confirm())) return;
            setBusy(true);
            await onPress();
          } catch (e) {
            Alert.alert("Couldn't complete that", e instanceof Error ? e.message : String(e));
          } finally {
            claimed.current = false;
            setBusy(false);
          }
        })()
      }
      style={[
        styles.action,
        { borderColor: primary ? t.accent : t.border },
        primary && { backgroundColor: t.accent },
        busy && { opacity: 0.5 },
      ]}
    >
      <Text
        style={[styles.actionText, { color: primary ? t.onAccent : t.text }]}
      >
        {busy ? (busyLabel ?? label) : label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  strip: {
    marginHorizontal: 12,
    marginBottom: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    padding: 10,
    gap: 8,
  },
  item: { flexDirection: "row", alignItems: "center", gap: 10 },
  text: { flex: 1, fontSize: type.small, lineHeight: 19 },
  hint: { fontSize: type.tiny, lineHeight: 17 },
  actions: { flexDirection: "row", justifyContent: "flex-end", gap: 8 },
  queue: { gap: 6, paddingHorizontal: 12, paddingBottom: 8 },
  queued: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderStyle: "dashed",
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  queuedText: { flex: 1, gap: 2 },
  action: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  actionText: { fontSize: type.tiny, fontWeight: "600" },
});
