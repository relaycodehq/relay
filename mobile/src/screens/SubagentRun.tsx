// The desktop's SubagentThread (src/features/agent-turn/SubagentThread.tsx) as
// a screen: the brief Claude gave an agent, its text and calls drawn as a
// turn, and what it reported. Read-only, with Stop while it works.
import { useMemo, useRef, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import { Stack } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { ChatMessage } from "../../../shared/projects";
import { plural } from "../../../shared/activity-labels";
import { agentKind, modelName, type SubagentDetail } from "../../../shared/subagents";
import { useSubagentRun } from "../remote/subagents";
import { AgentRun } from "../ui/AgentRun";
import { Markdown } from "../ui/Markdown";
import { SubagentMark, confirmStop, stopping } from "../ui/Subagents";
import { Action } from "../ui/ThreadExtras";
import { type, useTheme } from "../ui/theme";

export function SubagentRun({
  chatId,
  agentId,
  root,
}: {
  chatId: string;
  agentId: string;
  /** The thread's folder, which tool labels leave out. */
  root?: string;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { run, error, supported, stop, refresh } = useSubagentRun(
    chatId,
    agentId,
  );
  const scroll = useRef<ScrollView>(null);
  // Stays at the end while the run grows, unless you scrolled up.
  const follow = useRef(true);
  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: run ? agentKind(run) : "Agent" }} />
      {supported && error && (
        <View style={styles.error}>
          <Text style={[styles.note, { color: t.muted }]}>{error}</Text>
          <Action
            label="Retry"
            onPress={async () => {
              await refresh();
            }}
          />
        </View>
      )}
      {!run ? (
        <View style={styles.center}>
          {!supported ? (
            <Text style={[styles.note, { color: t.muted }]}>
              Update Relay on your computer to read an agent&apos;s run here.
            </Text>
          ) : run === null ? (
            <Text style={[styles.note, { color: t.muted }]}>
              This agent&apos;s run is gone: the session that ran it ended.
            </Text>
          ) : error ? null : (
            <ActivityIndicator color={t.muted} />
          )}
        </View>
      ) : (
        <ScrollView
          ref={scroll}
          contentContainerStyle={styles.content}
          onScroll={(e) => {
            const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
            follow.current =
              contentSize.height - contentOffset.y - layoutMeasurement.height < 80;
          }}
          scrollEventThrottle={100}
          onContentSizeChange={() => {
            if (follow.current && run.status === "running")
              scroll.current?.scrollToEnd({ animated: false });
          }}
        >
          <Run run={run} root={root} />
        </ScrollView>
      )}
      <View
        style={[
          styles.foot,
          { borderColor: t.border, paddingBottom: 10 + insets.bottom },
        ]}
      >
        <Text style={[styles.footText, { color: t.muted }]}>
          Read-only. Agents take instructions from Claude, not from you.
        </Text>
        {run?.status === "running" && (
          <Action
            label="Stop agent"
            busyLabel="Stopping…"
            confirm={() => confirmStop(run)}
            onPress={stopping(stop)}
          />
        )}
      </View>
    </View>
  );
}

function Run({ run, root }: { run: SubagentDetail; root?: string }) {
  const t = useTheme();
  const [whole, setWhole] = useState(false);
  const live = run.status === "running";
  const message = useMemo<ChatMessage>(
    () => ({
      id: `agent:${run.id}`,
      role: "assistant",
      provider: "claude",
      status: live
        ? "streaming"
        : run.status === "stopped"
          ? "cancelled"
          : run.status === "failed"
            ? "failed"
            : "complete",
      body: run.report ?? "",
      created: run.started,
      ...(run.ended ? { ended: run.ended } : {}),
      trace: run.trace,
      version: 1,
    }),
    [run, live],
  );
  return (
    <>
      <View style={styles.head}>
        <SubagentMark run={run} />
        <Text style={[styles.title, { color: t.text }]}>{run.description}</Text>
      </View>
      <Text style={[styles.about, { color: t.muted }]}>
        {[
          agentKind(run),
          run.model && modelName(run.model),
          plural(run.calls, "call"),
          run.status === "failed" && "failed",
        ]
          .filter(Boolean)
          .join(" · ")}
      </Text>
      {!!run.brief && (
        <View style={[styles.brief, { borderColor: t.border, backgroundColor: t.raised }]}>
          <Text style={[styles.label, { color: t.muted }]}>Claude&apos;s brief</Text>
          <Text
            selectable
            numberOfLines={whole ? undefined : 5}
            style={[styles.briefText, { color: t.text }]}
          >
            {run.brief}
          </Text>
          {!whole && run.brief.length > 220 && (
            <Text
              accessibilityRole="button"
              onPress={() => setWhole(true)}
              style={[styles.more, { color: t.accent }]}
            >
              Show all
            </Text>
          )}
        </View>
      )}
      {/* Its tool output comes cut, as a thread's does, and there's no turn to fetch the rest or its pictures from. */}
      <AgentRun chatId="" message={message} root={root} open />
      {!live && !!run.report && (
        <>
          <Text style={[styles.label, styles.reported, { color: t.muted }]}>
            Reported to Claude
          </Text>
          <Markdown text={run.report} />
        </>
      )}
      {run.status === "stopped" && (
        <Text style={[styles.stopped, { color: t.muted }]}>
          Stopped. Claude hears it was and carries on without it.
        </Text>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  error: { padding: 16, gap: 10, alignItems: "center" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  note: { fontSize: type.small, textAlign: "center" },
  content: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 24 },
  head: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { flex: 1, fontSize: type.title, fontWeight: "600" },
  about: { fontSize: type.small, marginTop: 4, marginLeft: 24 },
  brief: {
    marginTop: 14,
    marginBottom: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    padding: 12,
    gap: 6,
  },
  label: { fontSize: type.tiny, fontWeight: "600" },
  briefText: { fontSize: type.small, lineHeight: 19 },
  more: { fontSize: type.small, fontWeight: "600" },
  reported: { marginTop: 14, marginBottom: 4 },
  stopped: { fontSize: type.small, marginTop: 12 },
  foot: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  footText: { flex: 1, fontSize: type.tiny, lineHeight: 17 },
});
