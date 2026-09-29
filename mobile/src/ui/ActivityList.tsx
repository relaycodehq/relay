// The desktop sidebar's Activity view: one card per open thread, the ones that
// need nothing from you faded back, and Snoozed and Settled folded away below.
import { useMemo, useState, type ReactElement } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type RefreshControlProps,
} from "react-native";
import {
  CalendarClock,
  Check,
  ChevronRight,
  RotateCcw,
  Sunrise,
} from "lucide-react-native";
import {
  chatActivitySections,
  shortAge,
  snoozePresets,
  wakeLabel,
} from "../../../shared/chat-activity";
import type { RemoteChatSummary, RemoteProject } from "../../../shared/remote";
import { agentsSince } from "../../../shared/waiting";
import { useUnread } from "../remote/seen";
import { useNow } from "./motion";
import { ProjectBadge } from "./ProjectIcon";
import { ProviderIcon } from "./ProviderIcon";
import { MenuSheet } from "./Sheet";
import { mix, type, useTheme, type Palette } from "./theme";

/** The desktop's colour for threads waiting on you. */
const waitingColor = "#d99a2b";
const shelfPage = 5;

type Triage = (
  chat: RemoteChatSummary,
  action:
    | { kind: "settle" | "unsettle" | "wake" }
    | { kind: "snooze"; until: number },
) => void;

export function ActivityList({
  chats,
  projects,
  selected,
  onOpen,
  onTriage,
  refreshControl,
  bottom,
}: {
  chats: RemoteChatSummary[];
  projects: RemoteProject[];
  selected?: string;
  onOpen: (chat: RemoteChatSummary) => void;
  onTriage: Triage;
  refreshControl: ReactElement<RefreshControlProps>;
  /** Room under the list, e.g. for the New thread button. */
  bottom: number;
}) {
  const t = useTheme();
  const unread = useUnread();
  // Ages and "Sends at" labels move with the clock.
  const now = useNow(30_000);
  const byId = useMemo(
    () => new Map(projects.map((p) => [p.id, p])),
    [projects],
  );
  const sections = chatActivitySections(chats, now);
  const [acting, setActing] = useState<RemoteChatSummary>();
  const [shelves, setShelves] = useState({ snoozed: 0, settled: 0 });

  const project = (c: RemoteChatSummary) =>
    byId.get(c.projectId) ?? { id: c.projectId, name: "?" };

  const shelf = (kind: "snoozed" | "settled", label: string) => {
    const items = sections[kind];
    if (!items.length) return null;
    const shown = shelves[kind];
    return (
      <View style={styles.shelf}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: shown > 0 }}
          onPress={() =>
            setShelves((s) => ({ ...s, [kind]: shown ? 0 : shelfPage }))
          }
          style={styles.shelfToggle}
        >
          <Text style={[styles.shelfLabel, { color: t.muted }]}>
            {label} <Text style={styles.shelfCount}>{items.length}</Text>
          </Text>
          <View style={[styles.rule, { backgroundColor: t.border }]} />
          <ChevronRight
            size={14}
            color={t.muted}
            style={shown ? styles.turned : undefined}
          />
        </Pressable>
        {items.slice(0, shown).map((c) => (
          <Pressable
            key={c.id}
            accessibilityRole="button"
            accessibilityLabel={c.title}
            onPress={() => onOpen(c)}
            style={({ pressed }) => [
              styles.compact,
              (pressed || c.id === selected) && { backgroundColor: t.hover },
            ]}
          >
            <View style={styles.faded}>
              <ProjectBadge project={project(c)} />
            </View>
            <Text
              numberOfLines={1}
              style={[styles.compactTitle, { color: t.muted }]}
            >
              {c.title}
            </Text>
            <Text style={[styles.compactAge, { color: t.muted }]}>
              {kind === "snoozed"
                ? wakeLabel(c.snoozedUntil!, new Date(now))
                : shortAge(c.updated, now)}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                kind === "snoozed" ? "Wake now" : "Move back to activity"
              }
              hitSlop={8}
              onPress={() =>
                onTriage(c, { kind: kind === "snoozed" ? "wake" : "unsettle" })
              }
              style={styles.compactAction}
            >
              {kind === "snoozed" ? (
                <Sunrise size={15} color={t.muted} />
              ) : (
                <RotateCcw size={15} color={t.muted} />
              )}
            </Pressable>
          </Pressable>
        ))}
        {items.length > shown && shown > 0 && (
          <Pressable
            accessibilityRole="button"
            onPress={() =>
              setShelves((s) => ({ ...s, [kind]: shown + shelfPage }))
            }
            style={styles.compact}
          >
            <Text style={[styles.compactTitle, { color: t.muted }]}>
              Show {Math.min(shelfPage, items.length - shown)} more
            </Text>
          </Pressable>
        )}
      </View>
    );
  };

  return (
    <>
      <ScrollView
        refreshControl={refreshControl}
        contentContainerStyle={[styles.list, { paddingBottom: bottom }]}
      >
        <View style={styles.heading}>
          <Text style={[styles.headingText, { color: t.muted }]}>Activity</Text>
          <Text style={[styles.headingCount, { color: t.muted }]}>
            {sections.active.length
              ? `${sections.active.length} open`
              : "All settled"}
          </Text>
        </View>
        {sections.active.map((c) => (
          <Card
            key={c.id}
            chat={c}
            project={project(c)}
            unread={unread(c)}
            selected={c.id === selected}
            now={now}
            t={t}
            onPress={() => onOpen(c)}
            onLongPress={() => setActing(c)}
          />
        ))}
        {!sections.active.length && (
          <View style={styles.empty}>
            <View style={[styles.emptyIcon, { backgroundColor: t.accentSoft }]}>
              <Check size={18} color={t.accent} />
            </View>
            <Text style={[styles.emptyTitle, { color: t.text }]}>
              Inbox zero
            </Text>
            <Text style={[styles.emptyText, { color: t.muted }]}>
              Threads come back here when an agent replies or needs you.
            </Text>
          </View>
        )}
        {shelf("snoozed", "Snoozed")}
        {shelf("settled", "Settled")}
      </ScrollView>
      <MenuSheet
        open={!!acting}
        title={acting?.title}
        onClose={() => setActing(undefined)}
        items={
          acting
            ? [
                ...(!acting.running && !acting.waiting
                  ? [
                      {
                        label: "Settle",
                        hint: "Hide it until something new happens",
                        icon: <Check size={17} color={t.text} />,
                        onPress: () => onTriage(acting, { kind: "settle" }),
                      },
                    ]
                  : []),
                ...(!acting.waiting
                  ? snoozePresets(new Date(now)).map((p) => ({
                      label: `Snooze · ${p.label}`,
                      hint: wakeLabel(p.until, new Date(now)),
                      onPress: () =>
                        onTriage(acting, { kind: "snooze", until: p.until }),
                    }))
                  : []),
              ]
            : []
        }
      />
    </>
  );
}

function Card({
  chat,
  project,
  unread,
  selected,
  now,
  t,
  onPress,
  onLongPress,
}: {
  chat: RemoteChatSummary;
  project: Pick<RemoteProject, "id" | "name">;
  unread: boolean;
  selected: boolean;
  now: number;
  t: Palette;
  onPress: () => void;
  onLongPress: () => void;
}) {
  // Only the open thread, unread news and questions stay bright.
  const bright = selected || unread || chat.waiting;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={chat.title}
      accessibilityHint="Hold to settle or snooze"
      onPress={onPress}
      onLongPress={onLongPress}
      style={({ pressed }) => [
        styles.card,
        selected && { backgroundColor: mix(t.text, t.background, 0.09) },
        pressed && { backgroundColor: t.hover },
        !bright && !pressed && styles.dim,
      ]}
    >
      <View style={styles.top}>
        <ProjectBadge project={project} />
        <Text numberOfLines={1} style={[styles.project, { color: t.muted }]}>
          {project.name}
        </Text>
        <CardState chat={chat} unread={unread} now={now} t={t} />
      </View>
      <Text numberOfLines={1} style={[styles.title, { color: t.text }]}>
        {chat.title}
      </Text>
      {(chat.branch || chat.provider || chat.scope === "pr") && (
        <View style={styles.meta}>
          <Text
            numberOfLines={1}
            style={[styles.branch, { color: mix(t.muted, t.background, 0.7) }]}
          >
            {chat.scope === "pr" ? "Pull request · " : ""}
            {chat.branch}
          </Text>
          {chat.provider && (
            <View style={styles.provider}>
              <ProviderIcon
                provider={chat.provider}
                size={13}
                color={t.muted}
              />
            </View>
          )}
        </View>
      )}
    </Pressable>
  );
}

/** The top row's right side: what it's doing now, else how old it is. */
function CardState({
  chat,
  unread,
  now,
  t,
}: {
  chat: RemoteChatSummary;
  unread: boolean;
  now: number;
  t: Palette;
}) {
  if (chat.waiting)
    return (
      <View style={styles.state}>
        <View style={[styles.dot, { backgroundColor: waitingColor }]} />
        <Text style={[styles.stateText, { color: waitingColor }]}>
          Needs input
        </Text>
      </View>
    );
  const since = chat.running ? chat.runningSince : agentsSince(chat.pending);
  if (chat.running || since)
    return (
      <View style={styles.state}>
        <ActivityIndicator
          size="small"
          color={t.accent}
          style={styles.spinner}
        />
        <Text style={[styles.stateText, { color: t.accent }]}>
          Working
          {since ? <Elapsed since={since} /> : null}
        </Text>
      </View>
    );
  if (chat.snoozedUntil && chat.snoozedUntil <= now)
    return <Text style={[styles.stateText, { color: t.accent }]}>Woke up</Text>;
  if (chat.pending?.length)
    return (
      <View style={styles.state}>
        <View style={[styles.dot, styles.ring, { borderColor: t.accent }]} />
        <Text
          style={[styles.stateText, { color: unread ? t.accent : t.muted }]}
        >
          Waiting
        </Text>
      </View>
    );
  if (chat.nextSend && !unread)
    return (
      <View style={styles.state}>
        <CalendarClock size={12} color={t.muted} />
        <Text style={[styles.stateText, { color: t.muted }]}>
          Sends {wakeLabel(chat.nextSend, new Date(now))}
        </Text>
      </View>
    );
  return (
    <View style={styles.state}>
      {unread && <View style={[styles.dot, { backgroundColor: t.accent }]} />}
      <Text style={[styles.stateText, { color: unread ? t.accent : t.muted }]}>
        {shortAge(chat.updated, now)}
      </Text>
    </View>
  );
}

/** " 26s", " 4m 12s", " 1h 3m"; ticks by itself so only this label redraws. */
function Elapsed({ since }: { since: number }) {
  const seconds = Math.max(0, Math.floor((useNow(1000) - since) / 1000));
  return (
    <Text>
      {" "}
      {seconds < 60
        ? `${seconds}s`
        : seconds < 3600
          ? `${Math.floor(seconds / 60)}m ${seconds % 60}s`
          : `${Math.floor(seconds / 3600)}h ${Math.floor(seconds / 60) % 60}m`}
    </Text>
  );
}

const styles = StyleSheet.create({
  list: { paddingHorizontal: 8, paddingTop: 4 },
  heading: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 10,
    paddingTop: 8,
    paddingBottom: 6,
  },
  headingText: { fontSize: type.tiny, fontWeight: "500" },
  headingCount: { fontSize: type.tiny },
  card: {
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    marginBottom: 2,
  },
  dim: { opacity: 0.45 },
  top: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 22 },
  project: { flex: 1, fontSize: type.small },
  state: { flexDirection: "row", alignItems: "center", gap: 5 },
  stateText: { fontSize: type.small, fontVariant: ["tabular-nums"] },
  dot: { width: 6, height: 6, borderRadius: 3 },
  spinner: { width: 12, height: 12, transform: [{ scale: 0.6 }] },
  ring: { borderWidth: 1.5 },
  title: { fontSize: type.body, fontWeight: "500", lineHeight: 20 },
  meta: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 16 },
  branch: { flex: 1, fontSize: type.tiny },
  provider: { opacity: 0.75 },
  empty: {
    alignItems: "center",
    gap: 6,
    paddingTop: 26,
    paddingHorizontal: 18,
  },
  emptyIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  emptyTitle: { fontSize: type.body, fontWeight: "600" },
  emptyText: { fontSize: type.small, textAlign: "center", lineHeight: 19 },
  shelf: { marginTop: 14 },
  shelfToggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 8,
    paddingLeft: 10,
    paddingRight: 6,
  },
  shelfLabel: { fontSize: type.small },
  shelfCount: { fontWeight: "600" },
  rule: { flex: 1, height: StyleSheet.hairlineWidth },
  turned: { transform: [{ rotate: "90deg" }] },
  compact: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minHeight: 44,
    paddingLeft: 12,
    paddingRight: 4,
    borderRadius: 9,
  },
  faded: { opacity: 0.65 },
  compactTitle: { flex: 1, fontSize: type.small },
  compactAge: { fontSize: type.tiny },
  compactAction: { padding: 8 },
});
