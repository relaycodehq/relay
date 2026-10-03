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
import { placeDictation } from "../../../shared/dictation";
import { agents, agentProviders, type AgentProvider } from "../../../shared/agents";
import { sendLaterPresets, wakeLabel } from "../../../shared/chat-activity";
import { isComposerCommand, relayCommand, type ComposerCommand, type RelayCommand } from "../../../shared/commands";
import { composerCommand, type ModelCatalogs } from "../../../shared/composer-commands";
import type { ContextUsage } from "../../../shared/projects";
import type { RemoteSettings } from "../../../shared/remote";
import type { ModelChoice } from "../../../shared/settings";
import { switchAgent, withComposerChange, withRememberedModel } from "../../../shared/remote-compose";
import type { NewThreadModels } from "../../../shared/new-thread-models";
import {
  cancelDictation,
  clearDictationError,
  dictationSnapshot,
  phoneHasMic,
  stopDictation,
  useDictation,
  type DictationTarget,
} from "../remote/dictation";
import { maxImages, pickImages, type Attachment } from "../remote/images";
import { useRemote } from "../remote/RemoteProvider";
import { effortLabel, modeLabel, runtimeModes } from "../remote/modes";
import { CommandMenu, commandItems, useProviderCommands, type CommandItem } from "./CommandMenu";
import { DictationButton, dictationShrinkMs } from "./DictationButton";
import { useKeyboardShown } from "./KeyboardAware";
import { ModelSheet } from "./ModelSheet";
import { ProviderIcon, agentNames } from "./ProviderIcon";
import { MenuSheet } from "./Sheet";
import { UsageBar, UsageSheet, useUsage } from "./Usage";
import { mono, type, useTheme } from "./theme";

export interface Outgoing {
  body: string;
  settings: RemoteSettings;
  images: Attachment[];
  /** While an answer runs: a turn after it, or steered into it. */
  delivery?: "queue" | "steer";
  /** Send later: held until then. */
  sendAt?: number;
}

/** Dictated words going into `base` in place of `from`–`to`; they sit at `start`–`end`, the last `tentative` characters still unsure. */
interface Live {
  base: string;
  from: number;
  to: number;
  start: number;
  end: number;
  tentative: number;
}

/** A workspace command's outcome: done, or why not. */
export type CommandResult = boolean | string;

export interface ComposerHandle {
  /** Puts a queued message's text back to edit, after anything already typed. */
  restore(text: string): void;
}

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
    /** A new thread's models, per agent, for switching to one not picked here yet. */
    remembered?: NewThreadModels;
  }
>(function Composer(
  { projectId, settings, onSettings, placeholder, running, disabled, context, onSend, onStop, onCommand, draftKey, remembered },
  ref,
) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  // The keyboard covers the gesture bar, so its inset would only leave a gap.
  const keyboard = useKeyboardShown();
  const [text, setText] = useState("");
  const input = useRef<TextInput>(null);
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

  const { overview, desktop } = useRemote();
  // Desktops from before phone dictation don't say, and can't.
  const canDictate = phoneHasMic && !!overview?.dictation && overview.dictation !== "unsupported";
  const [dictationOwner] = useState(() => ({}));
  const dictation = useDictation();
  const dictating = dictation.owner === dictationOwner && dictation.phase !== "idle";
  const dictationError = dictation.owner === dictationOwner ? dictation.error : undefined;
  // The toolbar makes room for the waveform until the capsule has shrunk back.
  const [shrinking, setShrinking] = useState(false);
  const [wasDictating, setWasDictating] = useState(dictating);
  if (wasDictating !== dictating) {
    setWasDictating(dictating);
    setShrinking(!dictating);
  }
  useEffect(() => {
    if (!shrinking) return;
    const timer = setTimeout(() => setShrinking(false), dictationShrinkMs);
    return () => clearTimeout(timer);
  }, [shrinking]);
  const selection = useRef({ start: 0, end: 0 });
  const typed = useRef(text);
  useEffect(() => {
    typed.current = text;
  }, [text]);
  /** The draft the words go into, and where; `tentative` counts the words' last characters that may still change. */
  const [live, setLiveState] = useState<Live>();
  const liveRef = useRef<Live>(undefined);
  const setLive = (next: Live | undefined) => {
    liveRef.current = next;
    setLiveState(next);
  };
  /** The draft as the last dictation left it, for a send that waited on it. */
  const dictated = useRef("");
  const dictationTarget = (): DictationTarget => ({
    begin: () => {
      const base = typed.current;
      // At the cursor while typing; after the draft otherwise.
      const at = input.current?.isFocused() ? selection.current : { start: base.length, end: base.length };
      const from = Math.min(at.start, base.length),
        to = Math.min(Math.max(from, at.end), base.length);
      setLive({ base, from, to, start: from, end: from, tentative: 0 });
    },
    update: (settled, tentative) => {
      const current = liveRef.current;
      if (!current) return;
      const placed = placeDictation(
        current.base,
        current.from,
        current.to,
        [settled, tentative].filter(Boolean).join(" "),
      );
      setText(placed.text);
      setLive({ ...current, start: placed.start, end: placed.end, tentative: tentative.length });
    },
    end: (words) => {
      const current = liveRef.current;
      setLive(undefined);
      if (!current) return;
      const placed = placeDictation(current.base, current.from, current.to, words ?? "");
      dictated.current = words ? placed.text : current.base;
      setText(dictated.current);
      selection.current = { start: placed.end, end: placed.end };
    },
  });
  // Leaving the thread, or its draft, takes unfinished words back out.
  useEffect(
    () => () => {
      const now = dictationSnapshot();
      if (now.owner === dictationOwner && now.phase !== "idle") cancelDictation();
    },
    [dictationOwner, draftKey],
  );

  /** `next` on agent `to`, with the model kept for it here, else the one it last ran with. */
  const switched = (next: RemoteSettings, to: AgentProvider): RemoteSettings => {
    if (to === next.provider) return next;
    const kept = picks.current[to];
    const other = switchAgent(next, to);
    return kept
      ? {
          ...other,
          choice: { model: kept.model, fast: kept.fast, reasoningEffort: kept.reasoningEffort },
          ...(kept.contextWindow ? { contextWindow: kept.contextWindow } : {}),
        }
      : withRememberedModel(other, remembered ?? {});
  };
  const switchTo = (next: RemoteSettings, to: AgentProvider) => onSettings(switched(next, to));
  // The desktop lists each agent's models once; one it couldn't list is asked again next time.
  const catalogs = useRef<ModelCatalogs>({});
  // Kept in state too, so the toolbar can name the model once its list arrives.
  const [listed, setListed] = useState<{ from: typeof desktop; lists: ModelCatalogs }>();
  const loadCatalogs = async (wanted: readonly AgentProvider[]) => {
    await Promise.all(
      wanted
        .filter((p) => !catalogs.current[p])
        .map((p) => desktop("agentModels", p).then((list) => void (catalogs.current[p] = list), () => {})),
    );
    setListed({ from: desktop, lists: { ...catalogs.current } });
    return catalogs.current;
  };
  useEffect(() => {
    catalogs.current = {};
  }, [desktop]);
  useEffect(() => {
    if (catalogs.current[provider]) return;
    desktop("agentModels", provider).then(
      (list) => {
        catalogs.current[provider] = list;
        setListed({ from: desktop, lists: { ...catalogs.current } });
      },
      () => {},
    );
  }, [desktop, provider]);
  // Claude's ids are aliases ("opus"); the list carries the full name.
  const models = listed?.from === desktop ? listed.lists[provider] : undefined;
  const modelLabel = settings.choice.model
    ? (models?.find((m) => m.id === settings.choice.model)?.name ?? settings.choice.model)
    : "Default";
  /** The desktop's runCommand for a composer setting; with no value, its picker opens. */
  const setting = async (name: ComposerCommand, args: string): Promise<CommandResult> => {
    if (!args && name !== "plan" && name !== "fast") return setSheet(name === "permissions" ? "mode" : "model"), true;
    const known =
      name === "model" ? await loadCatalogs(agentProviders) : name === "effort" ? await loadCatalogs([provider]) : {};
    const change = composerCommand(name, args, {
      recipient: provider,
      targets: agentProviders,
      model: settings.choice.model,
      fast: settings.choice.fast,
      plan: settings.interactionMode === "plan",
      catalogs: known,
    });
    if (typeof change === "string") return change;
    onSettings(withComposerChange(settings, change, known, switched));
    return true;
  };
  const run = async (name: RelayCommand, args: string) => {
    const result: CommandResult = isComposerCommand(name)
      ? await setting(name, args)
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
      if (item.args?.startsWith("<") && !isComposerCommand(item.name)) return setText(`/${item.name} `);
      return void run(item.name, "");
    }
    if (item.kind === "command") return setText(`/${item.name} `);
    // A skill goes in where it was typed, as `$name`.
    setText(text.replace(/(^|\s)[$/][^\s]*$/, `$1$${item.name} `));
  };

  const empty = !text.trim() && !images.length;
  /** `written` is the draft when it hasn't reached `text` yet. */
  const send = async (delivery?: "queue" | "steer", sendAt?: number, written = text) => {
    // Sending mid-dictation waits for the last words to land in the draft.
    const now = dictationSnapshot();
    if (now.owner === dictationOwner && now.phase !== "idle") {
      if (await stopDictation()) await send(delivery, sendAt, dictated.current);
      return;
    }
    if ((!written.trim() && !images.length) || busy) return;
    const draft = written.trim();
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
        body: draft,
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
      {!!(error ?? dictationError) && (
        <Pressable onPress={() => (error ? setDismissed(text) : clearDictationError())}>
          <Text style={[styles.note, { color: t.danger }]}>{error ?? dictationError}</Text>
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
          ref={input}
          accessibilityLabel="Message"
          multiline
          // Typing goes on while it reconnects; only sending waits. Dictated
          // words hold it still until they settle.
          editable={!live}
          value={live ? undefined : text}
          onChangeText={setText}
          onSelectionChange={(e) => (selection.current = e.nativeEvent.selection)}
          placeholder={placeholder ?? `Message ${agentNames[provider]}`}
          placeholderTextColor={t.faint}
          style={[styles.input, { color: t.text }]}
        >
          {live && (
            <>
              <Text>{text.slice(0, live.end - live.tentative)}</Text>
              <Text style={{ color: t.muted }}>{text.slice(live.end - live.tentative, live.end)}</Text>
              <Text>{text.slice(live.end)}</Text>
            </>
          )}
        </TextInput>
        <View style={styles.toolbar}>
          <Tool label="Attach a photo" disabled={images.length >= maxImages} onPress={() => setSheet("attach")}>
            <ImagePlus size={17} color={t.muted} />
          </Tool>
          <Tool label="Agent and model" onPress={() => setSheet("model")}>
            <ProviderIcon provider={provider} color={t.muted} size={13} />
            <Text numberOfLines={1} style={[styles.toolText, { color: t.muted }]}>
              {modelLabel}
              {settings.choice.reasoningEffort ? ` · ${effortLabel(settings.choice.reasoningEffort)}` : ""}
              {provider === "codex" && settings.choice.fast ? " · Fast" : ""}
            </Text>
            <ChevronDown size={12} color={t.faint} />
          </Tool>
          {/* Room for the waveform on a narrow phone. */}
          {!dictating && !shrinking && (
            <>
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
            </>
          )}
          <View style={styles.spacer} />
          {dictating && dictation.phase === "listening" && (
            <Tool label="Discard dictation" onPress={cancelDictation}>
              <X size={16} color={t.muted} />
            </Tool>
          )}
          {!text && !dictating && (
            <Tool
              label="Commands"
              onPress={() => {
                setText("/");
                input.current?.focus();
              }}
            >
              <Text style={[styles.slash, { color: t.muted }]}>/</Text>
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
          {canDictate && (
            <DictationButton owner={dictationOwner} target={dictationTarget} disabled={disabled || busy} />
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
      <UsageBar provider={provider} usage={usage} context={context} onPress={() => setSheet("usage")} />
      <ModelSheet
        open={sheet === "model"}
        projectId={projectId}
        settings={settings}
        known={listed?.from === desktop ? listed.lists : undefined}
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
  slash: { fontFamily: mono, fontSize: 15, width: 18, textAlign: "center" },
  action: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", marginLeft: 4 },
  secondary: { borderWidth: 1.5 },
});
