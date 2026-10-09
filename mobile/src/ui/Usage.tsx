// The desktop's usage meters and context meter (UsageMeters,
// ContextWindowMeter), drawn from the same shared/provider-usage logic.
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  paceGap,
  presentWindow,
  type MeterPace,
  type ProviderUsage,
  type UsageMeter,
} from "../../../shared/provider-usage";
import { agentName, type AgentProvider } from "../../../shared/agents";
import type { ContextUsage } from "../../../shared/projects";
import { useRemote } from "../remote/RemoteProvider";
import { Button } from "./Button";
import { useForeground } from "./motion";
import { Sheet } from "./Sheet";
import { type, useTheme } from "./theme";

const rank: Record<MeterPace, number> = { ok: 0, warn: 1, hot: 2, spent: 3 };
const warn = "#e3a23a",
  hot = "#ef6a5a";
const paceColor = (pace: MeterPace, fallback: string) =>
  pace === "warn" ? warn : pace === "hot" || pace === "spent" ? hot : fallback;

/** Only Claude and Codex report plan limits. */
const hasUsage = (provider: AgentProvider) =>
  provider === "claude" || provider === "codex";

/** The last usage each computer reported per agent, so a thread opens with its meters drawn. */
const lastUsage = new Map<string, ProviderUsage>();

/** The agent's plan usage, looked up now and every few minutes while a thread is open. */
export function useUsage(provider: AgentProvider) {
  const { desktop, status, active } = useRemote();
  const foreground = useForeground();
  const key = `${active ?? ""}:${provider}`;
  const [usage, setUsage] = useState(() => ({ key, value: lastUsage.get(key) }));
  // Keyed by the connection and agent, not every thread update: each look asks
  // the provider's usage service.
  const load = useCallback(
    (force = false) => {
      if (!hasUsage(provider) || status !== "online" || !foreground) return;
      void desktop("providerUsage", provider as "claude" | "codex", force)
        .then((value) => {
          lastUsage.set(key, value);
          setUsage({ key, value });
        })
        .catch(() => {});
    },
    [desktop, status, foreground, provider, key],
  );
  // Not with the phone in a pocket: relay-watch keeps the app alive there.
  useEffect(() => {
    if (!foreground) return;
    load();
    const timer = setInterval(() => load(), 180_000);
    return () => clearInterval(timer);
  }, [load, foreground]);
  return {
    usage: usage.key === key ? usage.value : lastUsage.get(key),
    reload: load,
  };
}

function meters(usage: ProviderUsage | undefined): UsageMeter[] {
  return (
    usage?.windows.map((w) =>
      presentWindow(w, Date.now(), usage.activeHours),
    ) ?? []
  );
}

function usageLabel(usage: ProviderUsage | undefined) {
  const list = meters(usage);
  if (!list.length) return undefined;
  const worst = list.reduce((a, m) => (rank[m.pace] > rank[a.pace] ? m : a));
  return (
    list.map((m) => `${m.label} ${m.leftPercent}% left`).join(", ") +
    (worst.pace === "ok" ? "" : ", running hot")
  );
}

/**
 * The composer's footer: the context window and the plan's limits as thin
 * bars along the bottom edge, opening the usage sheet on a tap.
 */
export function UsageBar({
  provider,
  usage,
  context,
  onPress,
}: {
  provider: AgentProvider;
  usage?: ProviderUsage;
  context?: ContextUsage;
  onPress: () => void;
}) {
  const t = useTheme();
  const used = context?.maxTokens
    ? Math.min(100, Math.round((context.usedTokens / context.maxTokens) * 100))
    : undefined;
  const list = hasUsage(provider) ? meters(usage) : [];
  if (used == null && !list.length) return null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={[used != null ? `Context ${used}% full` : "", usageLabel(usage) ?? ""]
        .filter(Boolean)
        .join(", ")}
      hitSlop={6}
      onPress={onPress}
      style={styles.bar}
    >
      {used != null && (
        <BarMeter
          label="Context"
          value={`${used}%`}
          percent={used}
          color={paceColor(used >= 90 ? "hot" : used >= 75 ? "warn" : "ok", t.muted)}
        />
      )}
      {list.map((m) => (
        <BarMeter
          key={m.kind}
          label={m.label}
          value={`${m.leftPercent}% left`}
          percent={m.leftPercent}
          color={paceColor(m.pace, m.kind === "session" ? t.accent : t.muted)}
        />
      ))}
    </Pressable>
  );
}

function BarMeter({
  label,
  value,
  percent,
  color,
}: {
  label: string;
  value: string;
  percent: number;
  color: string;
}) {
  const t = useTheme();
  return (
    <View style={styles.barMeter}>
      <View style={styles.top}>
        <Text numberOfLines={1} style={[styles.barLabel, { color: t.faint }]}>
          {label}
        </Text>
        <Text numberOfLines={1} style={[styles.barLabel, styles.barValue, { color: t.muted }]}>
          {value}
        </Text>
      </View>
      <View style={[styles.barTrack, { backgroundColor: t.border }]}>
        <View style={[styles.fill, { width: `${Math.max(0, Math.min(100, percent))}%`, backgroundColor: color }]} />
      </View>
    </View>
  );
}

function formatTokens(value: number) {
  if (value < 1_000) return `${Math.round(value)}`;
  if (value < 10_000)
    return `${(value / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  if (value < 1_000_000) return `${Math.round(value / 1_000)}k`;
  return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
}

/** What the composer's ring and context meter open: the context window, then the plan's limits. */
export function UsageSheet({
  open,
  provider,
  usage,
  context,
  onClose,
  onCompact,
  onRefresh,
}: {
  open: boolean;
  provider: AgentProvider;
  usage?: ProviderUsage;
  context?: ContextUsage;
  onClose: () => void;
  onCompact?: () => Promise<void>;
  onRefresh: () => void;
}) {
  const t = useTheme();
  const [compacting, setCompacting] = useState(false);
  const list = meters(usage);
  const used = context?.maxTokens
    ? Math.min(100, (context.usedTokens / context.maxTokens) * 100)
    : undefined;
  return (
    <Sheet
      open={open}
      title={`${agentName(provider)} usage`}
      onClose={onClose}
    >
      <View style={styles.body}>
        {context && (
          <View style={styles.meter}>
            <View style={styles.top}>
              <Text style={[styles.label, { color: t.text }]}>Context</Text>
              <Text style={[styles.value, { color: t.muted }]}>
                {formatTokens(context.usedTokens)}
                {context.maxTokens
                  ? ` of ${formatTokens(context.maxTokens)}`
                  : ""}
                {used != null ? ` · ${Math.round(used)}% full` : ""}
              </Text>
            </View>
            {used != null && (
              <Track
                percent={used}
                color={paceColor(
                  used >= 90 ? "hot" : used >= 75 ? "warn" : "ok",
                  t.accent,
                )}
              />
            )}
            {context.totalTokens != null && (
              <Text style={[styles.hint, { color: t.muted }]}>
                {formatTokens(context.totalTokens)} tokens through the session
                so far
              </Text>
            )}
            {onCompact && (
              <Button
                label={compacting ? "Compacting…" : "Compact now"}
                disabled={compacting}
                style={styles.compact}
                onPress={() => {
                  setCompacting(true);
                  void onCompact().finally(() => {
                    setCompacting(false);
                    onClose();
                  });
                }}
              />
            )}
          </View>
        )}
        {!hasUsage(provider) ? (
          <Text style={[styles.hint, { color: t.muted }]}>
            {agentName(provider)} doesn't report plan limits.
          </Text>
        ) : !usage ? (
          <ActivityIndicator color={t.muted} />
        ) : !list.length ? (
          <Text style={[styles.hint, { color: t.muted }]}>
            {usage.message ?? "No usage limits reported"}
          </Text>
        ) : (
          list.map((m) => (
            <View key={m.kind} style={styles.meter}>
              <View style={styles.top}>
                <Text style={[styles.label, { color: t.text }]}>{m.label}</Text>
                <Text
                  style={[styles.value, { color: paceColor(m.pace, t.muted) }]}
                >
                  {m.leftPercent}% left
                </Text>
              </View>
              <Track
                percent={m.leftPercent}
                color={paceColor(m.pace, t.accent)}
                mark={m.paceLeftPercent ?? undefined}
              />
              <Text style={[styles.hint, { color: t.muted }]}>
                {[
                  paceGap(m),
                  m.limitLabel,
                  m.resetLabel,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </Text>
            </View>
          ))
        )}
        {hasUsage(provider) && (
          <Pressable
            accessibilityRole="button"
            onPress={() => onRefresh()}
            hitSlop={8}
          >
            <Text style={[styles.refresh, { color: t.accent }]}>
              Check again
            </Text>
          </Pressable>
        )}
      </View>
    </Sheet>
  );
}

function Track({
  percent,
  color,
  mark,
}: {
  percent: number;
  color: string;
  mark?: number;
}) {
  const t = useTheme();
  return (
    <View style={[styles.track, { backgroundColor: t.border }]}>
      <View
        style={[
          styles.fill,
          {
            width: `${Math.max(0, Math.min(100, percent))}%`,
            backgroundColor: color,
          },
        ]}
      />
      {mark != null && (
        <View
          style={[styles.mark, { left: `${mark}%`, backgroundColor: t.text }]}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 20, paddingBottom: 8, gap: 18 },
  meter: { gap: 6 },
  top: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
  },
  label: { fontSize: type.body, fontWeight: "600" },
  value: { fontSize: type.small, fontVariant: ["tabular-nums"] },
  hint: { fontSize: type.tiny, lineHeight: 17 },
  track: { height: 6, borderRadius: 3, overflow: "hidden" },
  fill: { height: "100%", borderRadius: 3 },
  mark: { position: "absolute", top: -1, width: 2, height: 8 },
  compact: { flexGrow: 0, marginTop: 6 },
  bar: { flexDirection: "row", gap: 14, paddingHorizontal: 8, paddingTop: 2 },
  barMeter: { flex: 1, gap: 3 },
  barLabel: { fontSize: 11 },
  barValue: { fontVariant: ["tabular-nums"] },
  barTrack: { height: 3, borderRadius: 1.5, overflow: "hidden" },
  refresh: {
    fontSize: type.small,
    fontWeight: "600",
    textAlign: "center",
    padding: 4,
  },
});
