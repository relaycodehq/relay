import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import {
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useDraft } from "../remote/drafts";
import * as Haptics from "expo-haptics";
import { ArrowUp, ChevronDown, ImagePlus, ListEnd, Square, X, Zap } from "lucide-react-native";
import { agents, agentProviders, type AgentProvider } from "../../../shared/agents";
import { atHour, wakeLabel } from "../../../shared/chat-activity";
import { composerCommands, relayCommand, type RelayCommand } from "../../../shared/commands";
import type { ContextUsage } from "../../../shared/projects";
import type { RemoteSettings } from "../../../shared/remote";
import { reasoningEffortSchema, type ModelChoice } from "../../../shared/settings";
import { switchAgent } from "../remote/compose";
import { maxImages, pickImages, type Attachment } from "../remote/images";
import { effortLabel, modeLabel, runtimeModes } from "../remote/modes";
import { CommandMenu, commandItems, useProviderCommands, type CommandItem } from "./CommandMenu";
import { useKeyboardShown } from "./KeyboardAware";
import { ModelSheet } from "./ModelSheet";
import { ProviderIcon, agentNames } from "./ProviderIcon";
import { MenuSheet } from "./Sheet";
import { UsageRing, UsageSheet, hasUsage, usageLabel, useUsage } from "./Usage";
import { type, useTheme } from "./theme";

export interface Outgoing {
  body: string;
  settings: RemoteSettings;
  images: Attachment[];
  /** While an answer runs: a turn after it, or steered into it. */
  delivery?: "queue" | "steer";
  /** Send later: held until then. */
  sendAt?: number;
}

/** A workspace command's outcome: done, or why not. */
export type CommandResult = boolean | string;

export interface ComposerHandle {
  /** Puts a queued message's text back to edit, after anything already typed. */
  restore(text: string): void;
}

/** The desktop's Send later choices (src/components/SendLaterMenu.tsx). */
function sendLaterPresets(now: Date) {
  const presets = [
    { label: "In 30 minutes", at: now.getTime() + 1_800_000 },
    { label: "In 1 hour", at: now.getTime() + 3_600_000 },
    { label: "In 3 hours", at: now.getTime() + 10_800_000 },
  ];
  if (now.getHours() < 17) presets.push({ label: "This evening", at: atHour(now, 0, 18) });
  presets.push({ label: "Tomorrow morning", at: atHour(now, 1, 9) });
  return presets;
}

const toggle = (args: string, current: boolean) =>
  args.toLowerCase() === "on" ? true : args.toLowerCase() === "off" ? false : !current;

/** The desktop's composer on a phone: the message, then agent, model, mode and Plan under it. */
export const Composer = forwardRef<
  ComposerHandle,
  {
    projectId: string;
    settings: RemoteSettings;
    onSettings: (settings: RemoteSettings) => void;
    placeholder?: string;
    running: boolean;
    disabled?: boolean;
    context?: ContextUsage;
    onSend: (message: Outgoing) => Promise<void>;
    onStop?: () => void;
    /** Relay's workspace commands: /changes, /files, /new, /clear, /compact. */
    onCommand?: (name: RelayCommand, args: string) => CommandResult | Promise<CommandResult>;
    /** Where unsent text is kept between visits: the thread, or the reply's root. */
    draftKey?: string;
  }
>(function Composer(
  { projectId, settings, onSettings, placeholder, running, disabled, context, onSend, onStop, onCommand, draftKey },
  ref,
) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  // The keyboard covers the gesture bar, so its inset would only leave a gap.
  const keyboard = useKeyboardShown();
  const [text, setText] = useState("");
  useDraft(draftKey, text, setText);
  const [images, setImages] = useState<Attachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [sheet, setSheet] = useState<"model" | "mode" | "attach" | "later" | "usage">();
  const [dismissed, setDismissed] = useState<string>();
  const { usage, reload: reloadUsage } = useUsage(settings.provider);
  const provider = settings.provider;
  const wantsCommands = /^\s*[/$]/.test(text) || /\s\$\S*$/.test(text);
  const { commands, loading, failed } = useProviderCommands(projectId, provider, wantsCommands);
  const items = dismissed === text ? null : commandItems(text, provider, commands);
  useImperativeHandle(ref, () => ({
    restore: (restored) => setText((old) => [old.trim(), restored.trim()].filter(Boolean).join("\n\n")),
  }));
  // Each agent keeps its own model while you switch between them, like the desktop's slots.
  const picks = useRef<Partial<Record<AgentProvider, ModelChoice & { contextWindow?: "200k" }>>>({});
  useEffect(() => {
    picks.current[settings.provider] = {
      ...settings.choice,
      ...(settings.contextWindow ? { contextWindow: settings.contextWindow } : {}),
    };
  }, [settings]);
  useEffect(() => setError(undefined), [text]);

  const switchTo = (next: RemoteSettings, to: AgentProvider) => {
    if (to === next.provider) return onSettings(next);
    const kept = picks.current[to];
    const switched = switchAgent(next, to);
    onSettings(
      kept
        ? {
            ...switched,
            choice: { model: kept.model, fast: kept.fast, reasoningEffort: kept.reasoningEffort },
            ...(kept.contextWindow ? { contextWindow: kept.contextWindow } : {}),
          }
        : switched,
    );
  };
  /** The desktop's runCommand for a composer setting; with no value, its picker opens. */
  const setting = (name: RelayCommand, args: string): CommandResult => {
    const value = args.toLowerCase();
    if (name === "provider") {
      if (!value) return setSheet("model"), true;
      const to = agentProviders.find((p) => p === value);
      if (!to) return `Choose one of: ${agentProviders.join(", ")}.`;
      return switchTo(settings, to), true;
    }
    if (name === "model") {
      if (!args) return setSheet("model"), true;
      onSettings({ ...settings, choice: { ...settings.choice, model: value === "default" ? "" : args } });
      return true;
    }
    if (name === "effort") {
      if (!args) return setSheet("model"), true;
      const effort = reasoningEffortSchema.safeParse(value === "default" ? "" : value);
      if (!effort.success) return "Choose a reasoning level such as low, medium or high.";
      onSettings({ ...settings, choice: { ...settings.choice, reasoningEffort: effort.data } });
      return true;
    }
    if (name === "permissions") {
      if (!args) return setSheet("mode"), true;
      const mode = runtimeModes.find((m) => m.value === value || m.label.toLowerCase() === value);
      if (!mode) return `Choose one of: ${runtimeModes.map((m) => m.value).join(", ")}.`;
      return onSettings({ ...settings, runtimeMode: mode.value }), true;
    }
    if (args && !["on", "off"].includes(value)) return `Use /${name} on or /${name} off.`;
    if (name === "plan") {
      const plan = toggle(args, settings.interactionMode === "plan");
      return onSettings({ ...settings, interactionMode: plan ? "plan" : "default" }), true;
    }
    if (!agents[provider].fast)
      return `Fast mode is only available for ${agentProviders.filter((p) => agents[p].fast).map((p) => agentNames[p]).join(" and ")}.`;
    return onSettings({ ...settings, choice: { ...settings.choice, fast: toggle(args, settings.choice.fast) } }), true;
  };
  const run = async (name: RelayCommand, args: string) => {
    const result: CommandResult = composerCommands.includes(name)
      ? setting(name, args)
      : name === "context"
        ? (setSheet("usage"), true)
        : onCommand
          ? await onCommand(name, args)
          : "That works in a thread.";
    if (typeof result === "string") setError(result);
    else if (result) setText("");
  };
  const pick = (item: CommandItem) => {
    if (item.kind === "relay") {
      // Required values are picked or typed after it; the rest run now.
      if (item.name === "btw") return setText("/btw ");
      if (item.args?.startsWith("<") && !composerCommands.includes(item.name)) return setText(`/${item.name} `);
      return void run(item.name, "");
    }
    if (item.kind === "command") return setText(`/${item.name} `);
    // A skill goes in where it was typed, as `$name`.
    setText(text.replace(/(^|\s)[$/][^\s]*$/, `$1$${item.name} `));
  };

  const empty = !text.trim() && !images.length;
  const send = async (delivery?: "queue" | "steer", sendAt?: number) => {
    if (empty || busy) return;
    const draft = text.trim();
    if (draft.startsWith("/")) {
      const command = relayCommand(draft);
      if (command && command.name !== "btw") return void run(command.name, command.args);
      if (command?.name === "btw" && !command.args) return setError("Add a question after /btw.");
      const name = /^\/([^\s]+)/.exec(draft)?.[1];
      const agentCommand = agents[provider].commandsAlone && commands.some((c) => c.name === name);
      const skill = agents[provider].skills && /^\/skill:[^\s]+(?:\s|$)/.test(draft);
      if (!command && !agentCommand && !skill)
        return setError(
          "Choose a command from the menu. Relay actions run on their own; add instructions after a skill or an agent's command.",
        );
    }
    setBusy(true);
    setError(undefined);
    // Cleared as it goes, so leaving mid-send doesn't keep it as a draft;
    // it comes back if sending fails.
    setText("");
    try {
      await onSend({
        body: draft || "Describe the attached screenshot.",
        settings,
        images,
        ...(sendAt ? { sendAt } : running ? { delivery: delivery ?? "queue" } : {}),
      });
      setImages([]);
    } catch (e) {
      setText((typed) => typed || draft);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const attach = (from: "library" | "camera") =>
    void pickImages(from, maxImages - images.length)
      .then((picked) => setImages((old) => [...old, ...picked].slice(0, maxImages)))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  const stop = running && empty && onStop;
  const used =
    context?.maxTokens && Math.min(100, Math.round((context.usedTokens / context.maxTokens) * 100));
  const plan = settings.interactionMode === "plan";
  return (
    <View
      style={[
        styles.dock,
        {
          borderColor: t.border,
          backgroundColor: t.background,
          paddingBottom: 10 + (keyboard ? 0 : insets.bottom),
        },
      ]}
    >
      {items && (
        <CommandMenu
          items={items}
          loading={loading}
          failed={failed}
          onPick={pick}
        />
      )}
      {!!error && (
        <Pressable onPress={() => setDismissed(text)}>
          <Text style={[styles.note, { color: t.danger }]}>{error}</Text>
        </Pressable>
      )}
      <View style={[styles.box, { borderColor: t.border, backgroundColor: t.raised }]}>
        {images.length > 0 && (
          <ScrollView horizontal style={styles.thumbs} contentContainerStyle={styles.thumbsRow}>
            {images.map((image, i) => (
              <View key={image.uri}>
                <Image source={{ uri: image.uri }} style={[styles.thumb, { borderColor: t.border }]} />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${image.name}`}
                  hitSlop={8}
                  onPress={() => setImages((old) => old.filter((_, j) => j !== i))}
                  style={[styles.unthumb, { backgroundColor: t.background }]}
                >
                  <X size={12} color={t.text} />
                </Pressable>
              </View>
            ))}
          </ScrollView>
        )}
        <TextInput
          accessibilityLabel="Message"
          multiline
          // Typing goes on while it reconnects; only sending waits.
          editable
          value={text}
          onChangeText={setText}
          placeholder={placeholder ?? `Message ${agentNames[provider]}`}
          placeholderTextColor={t.faint}
          style={[styles.input, { color: t.text }]}
        />
        <View style={styles.toolbar}>
          <Tool label="Attach a photo" disabled={images.length >= maxImages} onPress={() => setSheet("attach")}>
            <ImagePlus size={17} color={t.muted} />
          </Tool>
          <Tool label="Agent and model" onPress={() => setSheet("model")}>
            <ProviderIcon provider={provider} color={t.muted} size={13} />
            <Text numberOfLines={1} style={[styles.toolText, { color: t.muted }]}>
              {settings.choice.model || "Default"}
              {settings.choice.reasoningEffort ? ` · ${effortLabel(settings.choice.reasoningEffort)}` : ""}
              {provider === "codex" && settings.choice.fast ? " · Fast" : ""}
            </Text>
            <ChevronDown size={12} color={t.faint} />
          </Tool>
          <Tool label="Permissions" onPress={() => setSheet("mode")}>
            <Text numberOfLines={1} style={[styles.toolText, { color: t.muted }]}>
              {modeLabel(settings.runtimeMode)}
            </Text>
          </Tool>
          <Tool
            label={plan ? "Plan mode on" : "Plan mode off"}
            onPress={() => onSettings({ ...settings, interactionMode: plan ? "default" : "plan" })}
          >
            <Text style={[styles.toolText, { color: plan ? t.accent : t.muted }]}>Plan</Text>
          </Tool>
          <View style={styles.spacer} />
          {/* Queue and Steer both need the room while an answer runs. */}
          {(!!used || hasUsage(provider)) && !(running && !empty) && (
            <Tool
              label={[used ? `Context ${used}% full` : "", usageLabel(usage) ?? ""].filter(Boolean).join(", ") || "Usage"}
              onPress={() => setSheet("usage")}
            >
              {!!used && (
                <Text style={[styles.context, { color: used >= 85 ? t.danger : t.faint }]}>{used}%</Text>
              )}
              {hasUsage(provider) && <UsageRing usage={usage} size={18} />}
            </Tool>
          )}
          {running && !empty && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Steer now"
              accessibilityHint="Sends it into the running answer instead of after it"
              disabled={disabled || busy}
              hitSlop={6}
              onPress={() => {
                void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                void send("steer");
              }}
              style={[styles.action, styles.secondary, { borderColor: t.accent }]}
            >
              <Zap size={15} color={t.accent} />
            </Pressable>
          )}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={stop ? "Stop" : running ? "Queue" : "Send"}
            accessibilityHint={empty ? undefined : "Hold to send later"}
            disabled={disabled || busy || (!stop && empty)}
            onPress={stop ? onStop : () => void send()}
            onLongPress={empty ? undefined : () => setSheet("later")}
            hitSlop={8}
            style={[
              styles.action,
              {
                backgroundColor: stop || !empty ? t.accent : t.hover,
                opacity: disabled || busy ? 0.5 : 1,
              },
            ]}
          >
            {stop ? (
              <Square size={13} color={t.onAccent} fill={t.onAccent} />
            ) : running ? (
              <ListEnd size={16} color={empty ? t.faint : t.onAccent} />
            ) : (
              <ArrowUp size={18} color={empty ? t.faint : t.onAccent} strokeWidth={2.5} />
            )}
          </Pressable>
        </View>
      </View>
      <ModelSheet
        open={sheet === "model"}
        projectId={projectId}
        settings={settings}
        onClose={() => setSheet(undefined)}
        onChange={(next, to) => (to ? switchTo(next, to) : onSettings(next))}
      />
      <MenuSheet
        open={sheet === "mode"}
        title="Permissions"
        onClose={() => setSheet(undefined)}
        items={runtimeModes.map((m) => ({
          label: m.label,
          hint: m.description,
          checked: m.value === settings.runtimeMode,
          onPress: () => {
            if (m.value === "full-access" && settings.runtimeMode !== "full-access")
              return Alert.alert(
                "Allow full access?",
                "The agent will run commands and edit files on your computer without asking.",
                [
                  { text: "Cancel", style: "cancel" },
                  { text: "Allow", onPress: () => onSettings({ ...settings, runtimeMode: m.value }) },
                ],
              );
            onSettings({ ...settings, runtimeMode: m.value });
          },
        }))}
      />
      <MenuSheet
        open={sheet === "attach"}
        title="Attach"
        onClose={() => setSheet(undefined)}
        items={[
          { label: "Photo library", onPress: () => attach("library") },
          { label: "Take a photo", onPress: () => attach("camera") },
        ]}
      />
      <MenuSheet
        open={sheet === "later"}
        title="Send later"
        onClose={() => setSheet(undefined)}
        items={sendLaterPresets(new Date()).map((p) => ({
          label: p.label,
          hint: wakeLabel(p.at, new Date()),
          onPress: () => void send(undefined, p.at),
        }))}
      />
      <UsageSheet
        open={sheet === "usage"}
        provider={provider}
        usage={usage}
        context={context}
        onRefresh={() => reloadUsage(true)}
        onClose={() => setSheet(undefined)}
        onCompact={
          onCommand
            ? async () => {
                const result = await onCommand("compact", "");
                if (typeof result === "string") setError(result);
              }
            : undefined
        }
      />
    </View>
  );
});

function Tool({
  label,
  disabled,
  onPress,
  children,
}: {
  label: string;
  disabled?: boolean;
  onPress: () => void;
  children: React.ReactNode;
}) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      hitSlop={6}
      onPress={onPress}
      style={({ pressed }) => [styles.tool, pressed && { backgroundColor: t.hover }, disabled && { opacity: 0.4 }]}
    >
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  dock: { paddingHorizontal: 10, paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth, gap: 6 },
  note: { fontSize: type.tiny, paddingHorizontal: 6 },
  box: { borderWidth: 1, borderRadius: 18, paddingTop: 4, paddingBottom: 6, paddingHorizontal: 6 },
  thumbs: { flexGrow: 0 },
  thumbsRow: { gap: 8, padding: 6 },
  thumb: { width: 56, height: 56, borderRadius: 8, borderWidth: StyleSheet.hairlineWidth },
  unthumb: {
    position: "absolute",
    top: -6,
    right: -6,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  input: { fontSize: type.body, lineHeight: 21, maxHeight: 132, minHeight: 38, paddingHorizontal: 8, paddingVertical: 8 },
  toolbar: { flexDirection: "row", alignItems: "center", gap: 2 },
  tool: { flexDirection: "row", alignItems: "center", gap: 4, height: 32, paddingHorizontal: 6, borderRadius: 8, maxWidth: 140 },
  toolText: { fontSize: type.tiny, flexShrink: 1 },
  spacer: { flex: 1 },
  context: { fontSize: type.tiny, fontVariant: ["tabular-nums"] },
  action: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", marginLeft: 4 },
  secondary: { borderWidth: 1.5 },
});
