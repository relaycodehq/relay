import { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { router } from "expo-router";
import { randomUUID } from "expo-crypto";
import type { RuntimeMode } from "../../../shared/agent-modes";
import type { AgentProvider } from "../../../shared/agents";
import { useRemote } from "../remote/RemoteProvider";
import { Button } from "../ui/Button";
import { ProviderIcon, agentNames } from "../ui/ProviderIcon";
import { type, useTheme } from "../ui/theme";

// The desktop's runtime modes (shared/agent-modes.ts), worded for a phone.
const modes: { value: RuntimeMode; label: string; description: string }[] = [
  {
    value: "approval-required",
    label: "Supervised",
    description: "Asks before commands and file changes. You answer here.",
  },
  {
    value: "auto-accept-edits",
    label: "Auto-accept edits",
    description: "Edits files freely, asks before anything else.",
  },
  {
    value: "full-access",
    label: "Full access",
    description: "Runs commands and edits without asking.",
  },
];
const providers: AgentProvider[] = ["codex", "claude", "opencode"];

export default function NewThread() {
  const remote = useRemote();
  const t = useTheme();
  const overview = remote.overview;
  const recent = overview?.chats[0];
  const [projectId, setProjectId] = useState(
    recent?.projectId ?? overview?.projects[0]?.id,
  );
  const [provider, setProvider] = useState<AgentProvider>(
    recent?.provider ?? "codex",
  );
  const [mode, setMode] = useState<RuntimeMode>("approval-required");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const start = async () => {
    if (!projectId || !body.trim()) return;
    setBusy(true);
    setError(undefined);
    try {
      const chat = await remote.call("startChat", projectId, {
        id: randomUUID(),
        body: body.trim(),
        provider,
        runtimeMode: mode,
      });
      router.replace(`/chat/${chat.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };
  const choice = (on: boolean) => [
    styles.choice,
    { borderColor: on ? t.accent : t.border },
    on && { backgroundColor: t.accentSoft },
  ];
  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={[styles.label, { color: t.muted }]}>Project</Text>
        <View style={styles.group}>
          {overview?.projects.map((p) => (
            <Pressable
              key={p.id}
              accessibilityRole="radio"
              accessibilityState={{ checked: p.id === projectId }}
              onPress={() => setProjectId(p.id)}
              style={choice(p.id === projectId)}
            >
              <Text style={[styles.choiceText, { color: t.text }]}>{p.name}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={[styles.label, { color: t.muted }]}>Agent</Text>
        <View style={styles.row}>
          {providers.map((p) => (
            <Pressable
              key={p}
              accessibilityRole="radio"
              accessibilityState={{ checked: p === provider }}
              onPress={() => setProvider(p)}
              style={[choice(p === provider), styles.segment]}
            >
              <ProviderIcon provider={p} color={t.text} />
              <Text style={[styles.choiceText, { color: t.text }]}>{agentNames[p]}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={[styles.label, { color: t.muted }]}>How it works</Text>
        <View style={styles.group}>
          {modes.map((m) => (
            <Pressable
              key={m.value}
              accessibilityRole="radio"
              accessibilityState={{ checked: m.value === mode }}
              onPress={() => setMode(m.value)}
              style={choice(m.value === mode)}
            >
              <Text style={[styles.choiceText, { color: t.text }]}>{m.label}</Text>
              <Text style={[styles.hint, { color: t.muted }]}>{m.description}</Text>
            </Pressable>
          ))}
        </View>
        <TextInput
          accessibilityLabel="First message"
          multiline
          value={body}
          onChangeText={setBody}
          placeholder="What should we work on?"
          placeholderTextColor={t.faint}
          style={[styles.input, { color: t.text, borderColor: t.border, backgroundColor: t.raised }]}
        />
        {error && <Text style={[styles.hint, { color: t.danger }]}>{error}</Text>}
        <Button
          label={busy ? "Starting…" : "Start thread"}
          primary
          disabled={busy || !body.trim() || !projectId || remote.status !== "online"}
          onPress={() => void start()}
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: 16, gap: 10, paddingBottom: 40 },
  label: { fontSize: type.tiny, fontWeight: "600", marginTop: 8 },
  group: { gap: 8 },
  row: { flexDirection: "row", gap: 8 },
  choice: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
    gap: 3,
  },
  segment: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
  },
  choiceText: { fontSize: type.body },
  hint: { fontSize: type.tiny, lineHeight: 17 },
  input: {
    minHeight: 110,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    fontSize: type.body,
    lineHeight: 21,
    textAlignVertical: "top",
    marginTop: 8,
  },
});
