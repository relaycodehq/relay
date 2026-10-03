// The desktop composer's slash menu (src/features/composer/ComposerCommands.tsx):
// Relay's own actions, then the agent's commands or skills.
import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { agents, type AgentProvider } from "../../../shared/agents";
import {
  commandTrigger,
  relayCommands,
  type ProviderCommand,
  type RelayCommand,
} from "../../../shared/commands";
import { useRemote } from "../remote/RemoteProvider";
import { agentNames } from "./ProviderIcon";
import { mono, type, useTheme } from "./theme";

export type CommandItem =
  | { kind: "relay"; name: RelayCommand; label: string; description: string; args?: string }
  | { kind: "command" | "skill"; name: string; label: string; description: string; source: string };

// Relay's actions that have no phone counterpart yet.
const unavailable: RelayCommand[] = ["openpr"];
const sources: Record<NonNullable<ProviderCommand["source"]>, string> = {
  app: "App",
  repo: "Repo",
  project: "Project",
  personal: "Personal",
  system: "System",
  claude: "Claude",
  other: "Provider",
};

/** The agent's own commands, fetched once a menu first opens for it. */
export function useProviderCommands(projectId: string, provider: AgentProvider, wanted: boolean) {
  const remote = useRemote();
  const [cache, setCache] = useState<Partial<Record<AgentProvider, ProviderCommand[] | "failed">>>({});
  useEffect(() => {
    // A new Scratchpad thread has no folder until the computer makes one.
    if (!wanted || !projectId || cache[provider] || remote.status !== "online") return;
    void remote
      .desktop("projectCommands", projectId, provider)
      .then((list) => setCache((c) => ({ ...c, [provider]: list })))
      .catch(() => setCache((c) => ({ ...c, [provider]: "failed" })));
  }, [wanted, provider, projectId, cache, remote]);
  const list = cache[provider];
  return { commands: Array.isArray(list) ? list : [], failed: list === "failed", loading: wanted && !list };
}

/** What the menu offers for the text being typed, or null when it's closed. */
export function commandItems(
  text: string,
  provider: AgentProvider,
  commands: ProviderCommand[],
): CommandItem[] | null {
  const trigger = commandTrigger(text);
  // Relay's actions start a message; a slash mid-sentence is just text.
  if (!trigger || trigger.inline) return null;
  const query = trigger.query.toLowerCase();
  const commandsAlone = agents[provider].commandsAlone;
  const items: CommandItem[] = [
    ...(trigger.prefix === "/"
      ? relayCommands
          .filter((c) => !unavailable.includes(c.name))
          .map((c): CommandItem => ({
            kind: "relay",
            name: c.name,
            label: "/" + c.name + ("args" in c ? " " + c.args : ""),
            description: c.description,
            ...("args" in c ? { args: c.args } : {}),
          }))
      : []),
    ...commands
      .filter(() => trigger.prefix === "/" || !commandsAlone)
      .map((c): CommandItem =>
        commandsAlone
          ? {
              kind: "command",
              name: c.name,
              label: "/" + c.name + (c.argumentHint ? " " + c.argumentHint : ""),
              description: c.description,
              source: agentNames[provider],
            }
          : {
              kind: "skill",
              name: c.name.replace(/^skill:/, ""),
              label: (trigger.prefix === "/" ? "/skill:" : "$") + (c.displayName || c.name.replace(/^skill:/, "")),
              description: c.description,
              source: `${sources[c.source ?? "other"]} skill`,
            },
      ),
  ];
  return items
    .filter((c) => `${c.name} ${c.label}`.toLowerCase().includes(query))
    .slice(0, 60);
}

export function CommandMenu({
  items,
  loading,
  failed,
  onPick,
}: {
  items: CommandItem[];
  loading: boolean;
  failed: boolean;
  onPick: (item: CommandItem) => void;
}) {
  const t = useTheme();
  return (
    <View style={[styles.menu, { borderColor: t.border, backgroundColor: t.raised }]}>
      <ScrollView keyboardShouldPersistTaps="always" style={styles.scroll}>
        {items.map((item) => (
          <Pressable
            key={`${item.kind}:${item.name}`}
            accessibilityRole="button"
            accessibilityLabel={item.label}
            onPress={() => onPick(item)}
            style={({ pressed }) => [styles.item, pressed && { backgroundColor: t.hover }]}
          >
            <View style={styles.itemText}>
              <Text numberOfLines={1} style={[styles.label, { color: t.text }]}>
                {item.label}
              </Text>
              {!!item.description && (
                <Text numberOfLines={1} style={[styles.description, { color: t.muted }]}>
                  {item.description}
                </Text>
              )}
            </View>
            <Text style={[styles.source, { color: t.faint }]}>
              {item.kind === "relay" ? "Relay" : item.source}
            </Text>
          </Pressable>
        ))}
        {!items.length && (
          <Text style={[styles.note, { color: t.muted }]}>No matching commands.</Text>
        )}
      </ScrollView>
      {loading && <Text style={[styles.note, { color: t.muted }]}>Loading the agent's commands…</Text>}
      {failed && (
        <Text style={[styles.note, { color: t.muted }]}>
          The agent's commands are unavailable. Relay's actions still work.
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  menu: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 14, overflow: "hidden", maxHeight: 280 },
  scroll: { flexGrow: 0 },
  item: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, paddingVertical: 9 },
  itemText: { flex: 1, gap: 1 },
  label: { fontFamily: mono, fontSize: 13 },
  description: { fontSize: type.tiny },
  source: { fontSize: 11 },
  note: { fontSize: type.tiny, padding: 10 },
});
