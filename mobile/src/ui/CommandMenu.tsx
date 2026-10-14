// The desktop composer's `/` and `$` menus (src/features/composer/ComposerCommands.tsx):
// Relay's own actions, the agent's commands, and its skills.
import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { agentInfo, agentName, type AgentProvider } from "../../../shared/agents";
import {
  commandTrigger,
  relayCommands,
  type ProviderCommand,
  type RelayCommand,
} from "../../../shared/commands";
import {
  agentSkills,
  agentSlashCommands,
  searchSkills,
  searchSlashItems,
  skillLabel,
} from "../../../shared/skill-search";
import { useRemote } from "../remote/RemoteProvider";
import { mono, type, useTheme } from "./theme";

export type CommandItem =
  | { kind: "relay"; name: RelayCommand; label: string; description: string; args?: string }
  | { kind: "command"; name: string; label: string; description: string; source: string }
  | {
      kind: "skill";
      name: string;
      skill: ProviderCommand;
      label: string;
      description: string;
      source: string;
    };

// Relay's actions that have no phone counterpart yet.
const unavailable: RelayCommand[] = ["openpr", "meme"];
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
  const skills = agentSkills(commands);
  const skillItem = (c: ProviderCommand, label: string) => ({
    kind: "skill" as const,
    name: c.name,
    skill: c,
    label,
    description: c.description,
    source: `${sources[c.source ?? "other"]} skill`,
  });
  // Either menu puts a skill in as `$name`, which the agent's runtime starts.
  if (trigger.prefix === "$")
    return searchSkills(skills, trigger.query).map((c) => skillItem(c, skillLabel(c)));
  return searchSlashItems<CommandItem>(
    [
      ...relayCommands
        .filter((c) => !unavailable.includes(c.name))
        .filter((c) => c.name !== "btw" || !!agentInfo(provider)?.side)
        .map((c): CommandItem => ({
          kind: "relay",
          name: c.name,
          label: "/" + c.name + ("args" in c ? " " + c.args : ""),
          description: c.description,
          ...("args" in c ? { args: c.args } : {}),
        })),
      ...(agentInfo(provider)?.commandsAlone ? agentSlashCommands(commands) : [])
        // Relay runs its own command of the same name, e.g. /add-dir.
        .filter((c) => !relayCommands.some((r) => r.name === c.name))
        .map((c): CommandItem => ({
          kind: "command",
          name: c.name,
          label: "/" + c.name + (c.argumentHint ? " " + c.argumentHint : ""),
          description: c.description,
          source: agentName(provider),
        })),
      ...skills.map((c) => skillItem(c, `/skill:${c.name}`)),
    ],
    trigger.query,
  );
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
