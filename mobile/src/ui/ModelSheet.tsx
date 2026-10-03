import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Switch, Text, View } from "react-native";
import { Check } from "lucide-react-native";
import { agentProviders, type AgentDefaults, type AgentModel, type AgentProvider } from "../../../shared/agents";
import { modelEfforts } from "../../../shared/composer-commands";
import type { RemoteSettings } from "../../../shared/remote";
import type { ReasoningEffort } from "../../../shared/settings";
import type { ModelCatalogs } from "../../../shared/composer-commands";
import { useRemote } from "../remote/RemoteProvider";
import { effortLabel } from "../remote/modes";
import { ProviderIcon, agentNames } from "./ProviderIcon";
import { Segmented } from "./Rows";
import { Sheet } from "./Sheet";
import { type, useTheme } from "./theme";

/** The desktop's model picker, for a thumb: agent tabs, its models, effort, and Fast or the 200k window. */
export function ModelSheet({
  open,
  projectId,
  settings,
  known,
  onChange,
  onClose,
}: {
  open: boolean;
  projectId: string;
  settings: RemoteSettings;
  /** Lists the composer already has, shown while the sheet asks again. */
  known?: ModelCatalogs;
  /** Picking another agent here asks the composer to switch to it. */
  onChange: (settings: RemoteSettings, provider?: AgentProvider) => void;
  onClose: () => void;
}) {
  const t = useTheme();
  const remote = useRemote();
  const provider = settings.provider;
  const [models, setModels] = useState<Partial<Record<AgentProvider, AgentModel[]>>>({});
  const [defaults, setDefaults] = useState<Partial<Record<AgentProvider, AgentDefaults | null>>>({});
  const [error, setError] = useState<string>();
  useEffect(() => {
    if (!open || models[provider]) return;
    setError(undefined);
    Promise.all([
      remote.desktop("agentModels", provider),
      remote.desktop("agentDefaults", projectId, provider).catch(() => null),
    ])
      .then(([list, fallback]) => {
        setModels((m) => ({ ...m, [provider]: list }));
        setDefaults((d) => ({ ...d, [provider]: fallback }));
      })
      .catch((e) => {
        // Default and the thread's own model still work without the list.
        setModels((m) => ({ ...m, [provider]: [] }));
        setError(e instanceof Error ? e.message : String(e));
      });
  }, [open, provider, projectId, models, remote]);
  const list = models[provider] ?? known?.[provider];
  const model = list?.find((m) => m.id === settings.choice.model);
  const fallback = defaults[provider];
  const fallbackName = fallback?.model
    ? (list?.find((m) => m.id === fallback.model)?.name ?? fallback.model)
    : undefined;
  // On Default, the effort applies to whichever model the agent falls back to.
  const effortModel = model ?? (settings.choice.model ? undefined : list?.find((m) => m.id === fallback?.model));
  const efforts = effortModel?.efforts ?? [];
  // What Default runs, as the agent's own settings say, like the desktop's label.
  const defaultEffort =
    (settings.choice.model ? fallback?.efforts?.[settings.choice.model] : fallback?.effort) ||
    effortModel?.defaultEffort;
  const pick = (id: string) =>
    onChange({
      ...settings,
      choice: {
        ...settings.choice,
        model: id,
        // Only an effort the new model lacks goes back to its default, as on the desktop.
        reasoningEffort: modelEfforts(provider, id, { [provider]: list }).includes(
          settings.choice.reasoningEffort,
        )
          ? settings.choice.reasoningEffort
          : "",
      },
    });
  const current = (list ?? []).filter((m) => !m.legacy);
  const legacy = (list ?? []).filter((m) => m.legacy);
  return (
    <Sheet open={open} title="Model" onClose={onClose}>
      <View style={styles.tabs}>
        <Segmented
          value={provider}
          options={agentProviders.map((p) => ({ value: p, label: agentNames[p] }))}
          onChange={(p) => onChange(settings, p)}
        />
      </View>
      {efforts.length > 0 && (
        <>
          <Text style={[styles.section, styles.first, { color: t.muted }]}>Reasoning</Text>
          <View style={styles.chips}>
            {(["", ...efforts] as ReasoningEffort[]).map((e) => {
              const on = e === settings.choice.reasoningEffort;
              return (
                <Pressable
                  key={e || "default"}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: on }}
                  onPress={() =>
                    onChange({ ...settings, choice: { ...settings.choice, reasoningEffort: e } })
                  }
                  style={[
                    styles.chip,
                    { borderColor: on ? t.accent : t.border },
                    on && { backgroundColor: t.accentSoft },
                  ]}
                >
                  <Text style={[styles.chipText, { color: t.text }]}>
                    {e ? effortLabel(e) : defaultEffort ? `Default · ${effortLabel(defaultEffort)}` : "Default"}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </>
      )}
      {error && (
        <Text style={[styles.note, { color: t.muted }]}>
          Couldn't list {agentNames[provider]}'s models: {error}
        </Text>
      )}
      {!list ? (
        <ActivityIndicator style={styles.loading} color={t.muted} />
      ) : (
        <>
          <ModelRow
            provider={provider}
            label="Default"
            hint={fallbackName ? `Uses ${fallbackName}` : "The agent's own choice"}
            checked={!settings.choice.model}
            onPress={() => pick("")}
          />
          {!!settings.choice.model && !model && (
            <ModelRow
              provider={provider}
              label={settings.choice.model}
              hint="What this thread last used"
              checked
              onPress={() => {}}
            />
          )}
          {current.map((m) => (
            <ModelRow
              key={m.id}
              provider={provider}
              label={m.name}
              hint={m.group ? `${m.group} · ${m.description}` : m.description}
              checked={m.id === settings.choice.model}
              onPress={() => pick(m.id)}
            />
          ))}
          {legacy.length > 0 && (
            <Text style={[styles.section, { color: t.muted }]}>Older models</Text>
          )}
          {legacy.map((m) => (
            <ModelRow
              key={m.id}
              provider={provider}
              label={m.name}
              hint={m.description}
              checked={m.id === settings.choice.model}
              onPress={() => pick(m.id)}
            />
          ))}
        </>
      )}
      {provider === "codex" && (
        <Toggle
          label="Fast"
          hint="Codex's faster service tier; uses more of your limit."
          value={settings.choice.fast}
          onChange={(fast) => onChange({ ...settings, choice: { ...settings.choice, fast } })}
        />
      )}
      {provider === "claude" && (
        <Toggle
          label="200k context window"
          hint="Off leaves Claude on its default window, 1M on most models."
          value={settings.contextWindow === "200k"}
          onChange={(on) => {
            const { contextWindow: _, ...rest } = settings;
            onChange(on ? { ...rest, contextWindow: "200k" } : rest);
          }}
        />
      )}
    </Sheet>
  );
}

function ModelRow({
  provider,
  label,
  hint,
  checked,
  onPress,
}: {
  provider: AgentProvider;
  label: string;
  hint?: string;
  checked: boolean;
  onPress: () => void;
}) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked }}
      onPress={onPress}
      style={({ pressed }) => [styles.row, (pressed || checked) && { backgroundColor: t.hover }]}
    >
      <ProviderIcon provider={provider} color={t.muted} size={15} />
      <View style={styles.rowText}>
        <Text style={[styles.label, { color: t.text }]}>{label}</Text>
        {!!hint && (
          <Text numberOfLines={2} style={[styles.hint, { color: t.muted }]}>
            {hint}
          </Text>
        )}
      </View>
      {checked && <Check size={16} color={t.accent} />}
    </Pressable>
  );
}

function Toggle({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  const t = useTheme();
  return (
    <View style={styles.row}>
      <View style={styles.rowText}>
        <Text style={[styles.label, { color: t.text }]}>{label}</Text>
        <Text style={[styles.hint, { color: t.muted }]}>{hint}</Text>
      </View>
      <Switch
        accessibilityLabel={label}
        value={value}
        onValueChange={onChange}
        trackColor={{ true: t.accent, false: t.border }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  tabs: { paddingHorizontal: 16, paddingBottom: 8 },
  loading: { padding: 24 },
  note: { fontSize: type.small, padding: 20 },
  section: { fontSize: type.tiny, fontWeight: "600", paddingHorizontal: 20, paddingTop: 14, paddingBottom: 6 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 20, minHeight: 52, paddingVertical: 8 },
  rowText: { flex: 1, gap: 2 },
  label: { fontSize: type.body },
  hint: { fontSize: type.tiny, lineHeight: 17 },
  first: { paddingTop: 4 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingHorizontal: 20, paddingBottom: 8 },
  chip: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  chipText: { fontSize: type.small },
});
