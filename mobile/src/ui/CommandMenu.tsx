// The desktop composer's slash menu (src/features/composer/ComposerCommands.tsx):
// Relay's own actions, then the agent's commands or skills.
import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { agentInfo, agentName, type AgentProvider } from "../../../shared/agents";
import {
  commandTrigger,
  relayCommands,
  type ProviderCommand,
  type RelayCommand,
} from "../../../shared/commands";
import { useRemote } from "../remote/RemoteProvider";
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
  const { desktop, status } = useRemote();
  type Lists = Partial<Record<AgentProvider, ProviderCommand[] | "failed">>;
  const [held, setHeld] = useState(() => ({ desktop, status, projectId, lists: {} as Lists }));
  const sameProject = held.desktop === desktop && held.projectId === projectId;
  if (!sameProject) setHeld({ desktop, status, projectId, lists: {} });
  else if (held.status !== status)
    // A reconnect retries the lists that failed; the ones it got still hold.
    setHeld({
      ...held,
      status,
      lists: Object.fromEntries(
        Object.entries(held.lists).filter(([, list]) => list !== "failed"),
      ) as Lists,
    });
  const list = sameProject && held.status === status ? held.lists[provider] : undefined;
  useEffect(() => {
    // A new Scratchpad thread has no folder until the computer makes one.
    if (!wanted || !projectId || list || status !== "online") return;
    let live = true;
    const keep = (commands: ProviderCommand[] | "failed") => {
      if (!live) return;
      setHeld((h) => h.desktop === desktop && h.projectId === projectId
        ? { ...h, lists: { ...h.lists, [provider]: commands } }
        : h);
    };
    void desktop("projectCommands", projectId, provider).then(keep, () => keep("failed"));
    return () => { live = false; };
  }, [wanted, provider, projectId, list, desktop, status]);
  return {
    commands: Array.isArray(list) ? list : [],
    failed: list === "failed",
    loading: wanted && !!projectId && status === "online" && !list,
  };
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
  const commandsAlone = agentInfo(provider)?.commandsAlone;
  const items: CommandItem[] = [
    ...(trigger.prefix === "/"
      ? relayCommands
          .filter((c) => !unavailable.includes(c.name))
          .filter((c) => c.name !== "btw" || !!agentInfo(provider)?.side)
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
              source: agentName(provider),
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
      {loading && <Text style={[styles.note, { color: t.muted }]}>Loading the agent&apos;s commands…</Text>}
      {failed && (
        <Text style={[styles.note, { color: t.muted }]}>
          The agent&apos;s commands are unavailable. Relay&apos;s actions still work.
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  menu: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 14, overflow: "hidden", maxHeight: 280, flexShrink: 1 },
  scroll: { flexGrow: 0, flexShrink: 1 },
  item: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, paddingVertical: 9 },
  itemText: { flex: 1, gap: 1 },
  label: { fontFamily: mono, fontSize: 13 },
  description: { fontSize: type.tiny },
  source: { fontSize: 11 },
  note: { fontSize: type.tiny, padding: 10 },
});
