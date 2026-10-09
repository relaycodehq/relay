// The phone's copy of the desktop's AgentTurn (src/features/agent-turn/AgentTurn.tsx):
// same structure, wording and states, from the same shared/agent-trace logic.
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  Animated,
  Easing,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  Bot,
  Brain,
  ChevronRight,
  Clock3,
  FilePen,
  FileText,
  Globe,
  Search,
  Terminal,
  Wrench,
} from "lucide-react-native";
import type { AgentActivity, ChatMessage } from "../../../shared/projects";
import { activityDetailBridge } from "../../../shared/remote";
import {
  doneLabel,
  duration,
  liveLabel,
  summarizeActivity,
} from "../../../shared/activity-labels";
import {
  batchHead,
  groupTrace,
  imageRead,
  looksAtImage,
  readTurn,
  thinkingWord,
  turnHeading,
} from "../../../shared/agent-trace";
import { useRemote } from "../remote/RemoteProvider";
import { ReadPreview, ReadSwatch } from "./images/Images";
import { Markdown } from "./Markdown";
import { useReducedMotion, useTick } from "./motion";
import { Shine } from "./Shine";
import { mono, useTheme } from "./theme";

const icons = {
  command: Terminal,
  read: FileText,
  file: FilePen,
  search: Search,
  web: Globe,
  agent: Bot,
  tool: Wrench,
} satisfies Record<AgentActivity["kind"], unknown>;

/**
 * Each agent call's own tool calls, how to show their paths, whose turn they're
 * in, and how to open an image the turn looked at. Without a chatId (a
 * subagent's own run) there's no turn to fetch pictures or whole output from.
 */
const Subagents = createContext<{
  calls: Map<string, AgentActivity[]>;
  display: (text: string) => string;
  chatId: string;
  messageId: string;
  openImage?: (path: string) => void;
}>({
  calls: new Map(),
  display: (text) => text,
  chatId: "",
  messageId: "",
});

/**
 * True while the reader is scrolled back in the thread. A turn that ends then
 * stays open until they're at the bottom again: folding it would pull the
 * answer below it out from under them.
 */
export const ReadingBack = createContext(false);

export function AgentRun({
  chatId,
  message,
  root,
  onOpenImage,
  onExpanded,
  open,
}: {
  chatId: string;
  message: ChatMessage;
  root?: string;
  /** Opens an image the turn looked at, by its path, among the others it looked at. */
  onOpenImage?: (path: string) => void;
  /** Told as the trace opens and folds; open, it shows the images its calls looked at. */
  onExpanded?: (expanded: boolean) => void;
  /** Starts unfolded even once it's ended, e.g. as a subagent's whole run. */
  open?: boolean;
}) {
  const t = useTheme();
  const turn = readTurn(message);
  const { live, entries, shown, calls, thinking } = turn;
  // Open while the turn runs; folds back once it ends unless the reader toggled it.
  const [toggled, setToggled] = useState<boolean>();
  const readingBack = useContext(ReadingBack);
  const [wasLive, setWasLive] = useState(live);
  const [held, setHeld] = useState(false);
  if (wasLive !== live) {
    setWasLive(live);
    if (!live && readingBack) setHeld(true);
  }
  if (held && !readingBack) setHeld(false);
  const expanded = toggled ?? (open || live || held);
  const traced = expanded && entries.length > 0;
  useEffect(() => onExpanded?.(traced), [traced, onExpanded]);
  if (!live && !entries.length) return null;
  const prefix = root && root.replace(/\/+$/, "") + "/";
  const display = (text: string) => (prefix ? text.split(prefix).join("") : text);
  const heading = turnHeading(message, expanded, turn);
  const HeaderIcon =
    heading.kind === "working"
      ? Clock3
      : heading.kind === "call"
        ? icons[heading.activity.kind]
        : heading.kind === "done"
          ? heading.last
            ? icons[heading.last.kind]
            : Brain
          : null;
  // Folded and live, the heading stands in for the live row, so it's what moves.
  const label =
    heading.kind === "thinking" ? (
      <ThinkingWord seed={message.id} />
    ) : heading.kind === "working" ? (
      <Text style={[styles.runLabel, { color: t.muted }]}>Working for</Text>
    ) : heading.kind === "done" ? (
      <Text numberOfLines={1} style={[styles.runLabel, { color: t.muted }]}>
        {heading.text}
      </Text>
    ) : (
      <Shine style={styles.runLabel}>
        {heading.kind === "call" ? display(liveLabel(heading.activity)) : "Writing"}
      </Shine>
    );
  return (
    <View style={styles.run}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        onPress={() => setToggled(!expanded)}
        hitSlop={6}
        style={styles.runHeading}
      >
        {HeaderIcon ? (
          <HeaderIcon size={14} color={t.muted} />
        ) : (
          <ThinkingGlyph provider={message.provider} />
        )}
        {label}
        <Text style={[styles.runTime, { color: t.muted }]}>
          {live ? (
            <WorkingTimer started={message.created} />
          ) : message.ended ? (
            `${message.status === "cancelled" ? "Stopped after " : ""}${duration(message.ended - message.created)}`
          ) : null}
        </Text>
        <ChevronRight
          size={13}
          color={t.faint}
          style={expanded ? styles.turned : undefined}
        />
      </Pressable>
      {expanded && (entries.length > 0 || thinking) && (
        <Subagents.Provider
          value={{ calls, display, chatId, messageId: message.id, openImage: onOpenImage }}
        >
          <View style={styles.trace} accessibilityLabel="Agent activity">
            {groupTrace(shown).map((part, index, parts) =>
              part.kind === "commentary" ? (
                <View key={part.id} style={styles.commentary}>
                  <Markdown text={part.text} small />
                </View>
              ) : live && index === parts.length - 1 ? (
                <OpenBatch key={part.id} activity={part.activity} />
              ) : part.activity.length === 1 ? (
                <ToolRow
                  key={part.id}
                  activity={part.activity[0]!}
                  label={display(part.activity[0]!.label)}
                />
              ) : (
                <ActivityGroup key={part.id} activity={part.activity} />
              ),
            )}
            {/* Keeps its height while a call runs, so the thread doesn't jolt. */}
            {live && !message.body && (
              <View style={styles.step}>
                {thinking && (
                  <>
                    <ThinkingGlyph provider={message.provider} />
                    <ThinkingWord seed={message.id} />
                  </>
                )}
              </View>
            )}
          </View>
        </Subagents.Provider>
      )}
    </View>
  );
}

/** A fold that builds its body the first time it opens; `under` goes below its heading. */
function Fold({
  heading,
  under,
  children,
}: {
  heading: ReactNode;
  under?: (open: boolean) => ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen(!open)}
        style={styles.step}
      >
        {heading}
      </Pressable>
      {under?.(open)}
      {open && children}
    </View>
  );
}

function ToolRow({ activity: a, label }: { activity: AgentActivity; label: string }) {
  const t = useTheme();
  // A failed call looks like any other: commands fail as part of the work.
  const Icon = icons[a.kind];
  const { calls: subagents, chatId } = useContext(Subagents);
  const calls = subagents.get(a.id) ?? [];
  const preview = looksAtImage(a) && !!chatId && (
    <View style={styles.under}>
      <Preview activity={a} name={label} />
    </View>
  );
  const heading = (
    <>
      {a.status === "running" ? (
        <ActivityIndicator size={14} color={t.muted} />
      ) : (
        <Icon size={14} color={t.muted} style={styles.icon} />
      )}
      <Text
        numberOfLines={1}
        style={[
          styles.stepLabel,
          a.kind === "command" && styles.mono,
          { color: t.muted },
        ]}
      >
        {label}
      </Text>
      <Progress activity={a} />
    </>
  );
  if (!a.detail && !calls.length)
    return (
      <View>
        <View style={styles.step}>{heading}</View>
        {preview}
      </View>
    );
  return (
    <Fold heading={heading} under={() => preview}>
      {calls.length > 0 && <SubagentRows calls={calls} />}
      {!!a.detail && <Detail activity={a} />}
    </Fold>
  );
}

/** The picture a call looked at, under its row. */
function Preview({ activity: a, name }: { activity: AgentActivity; name: string }) {
  const { chatId, messageId, openImage } = useContext(Subagents);
  return (
    <ReadPreview
      key={a.label}
      source={{ kind: "read", chatId, messageId, path: a.label }}
      name={name}
      done={a.status === "complete"}
      onOpen={openImage && (() => openImage(a.label))}
    />
  );
}

/** A call's output; the desktop sends a long one cut, and the whole of it once the fold opens. */
function Detail({ activity: a }: { activity: AgentActivity }) {
  const t = useTheme();
  const { chatId, messageId } = useContext(Subagents);
  const { call, overview } = useRemote();
  const [whole, setWhole] = useState<string>();
  const cut = !!a.detailCut && (overview?.bridge ?? 1) >= activityDetailBridge;
  useEffect(() => {
    if (!cut || !chatId) return;
    let live = true;
    call("activityDetail", chatId, messageId, a.id).then(
      (detail) => live && detail && setWhole(detail),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [cut, call, chatId, messageId, a.id]);
  return (
    <ScrollView nestedScrollEnabled style={[styles.detail, { backgroundColor: t.toolbar }]}>
      <Text selectable style={[styles.detailText, { color: t.muted }]}>
        {whole ?? a.detail}
      </Text>
    </ScrollView>
  );
}

function SubagentRows({ calls }: { calls: AgentActivity[] }) {
  const { display } = useContext(Subagents);
  return (
    <View style={styles.rows}>
      {calls.map((c) => (
        <ToolRow key={c.id} activity={c} label={display(c.label)} />
      ))}
    </View>
  );
}

/** A run of tool calls between two commentary lines, folded into "Ran 6 commands". */
function ActivityGroup({ activity }: { activity: AgentActivity[] }) {
  const t = useTheme();
  const { display, chatId } = useContext(Subagents);
  const kinds = new Set(activity.map((a) => a.kind));
  const Icon = kinds.size === 1 ? icons[activity[0]!.kind] : Wrench;
  // Closed, the pictures its calls looked at still show; open, each sits under its own row.
  const looked = chatId ? activity.filter(looksAtImage) : [];
  return (
    <Fold
      under={(open) =>
        !open &&
        looked.length > 0 && (
          <ScrollView horizontal style={styles.under} contentContainerStyle={styles.previews}>
            {looked.map((a) => (
              <Preview key={a.id} activity={a} name={display(a.label)} />
            ))}
          </ScrollView>
        )
      }
      heading={
        <>
          <Icon size={14} color={t.muted} style={styles.icon} />
          <Text numberOfLines={1} style={[styles.stepLabel, { color: t.muted }]}>
            {summarizeActivity(activity)}
          </Text>
        </>
      }
    >
      <View style={styles.rows}>
        {activity.map((a) => (
          <ToolRow key={a.id} activity={a} label={display(a.label)} />
        ))}
      </View>
    </Fold>
  );
}

/**
 * The batch still being worked on: one row names the latest call, and the
 * ones before it fold behind that row.
 */
function OpenBatch({ activity }: { activity: AgentActivity[] }) {
  const t = useTheme();
  const { display, calls: subagents, chatId, messageId, openImage } = useContext(Subagents);
  const [open, setOpen] = useState(false);
  const { head, earlier } = batchHead(activity);
  const running = head.status === "running";
  const Icon = icons[head.kind];
  const calls = subagents.get(head.id) ?? [];
  const folded = earlier.length > 0 || calls.length > 0;
  const text = display(running ? liveLabel(head) : doneLabel(head));
  // This row changes with every call, so a picture it looked at stays icon-sized
  // here; with nothing folded behind the row, tapping it opens the picture.
  const looked = chatId ? imageRead(head) : undefined;
  const view = !folded && looked && openImage ? () => openImage(looked) : undefined;
  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityState={folded ? { expanded: open } : undefined}
        disabled={!folded && !view}
        onPress={view ?? (() => setOpen(!open))}
        style={styles.step}
      >
        {looked ? (
          <ReadSwatch source={{ kind: "read", chatId, messageId, path: looked }} />
        ) : (
          <Icon size={14} color={t.muted} style={styles.icon} />
        )}
        {running ? (
          <Shine style={styles.stepText}>{text}</Shine>
        ) : (
          <Text numberOfLines={1} style={[styles.stepText, { color: t.muted }]}>
            {text}
          </Text>
        )}
        <Progress activity={head} />
        {folded && (
          <ChevronRight
            size={13}
            color={t.faint}
            style={open ? styles.turned : undefined}
          />
        )}
      </Pressable>
      {open && looked && (
        <View style={styles.under}>
          <Preview activity={head} name={display(head.label)} />
        </View>
      )}
      {open && calls.length > 0 && <SubagentRows calls={calls} />}
      {open && earlier.length > 0 && (
        <View style={styles.rows}>
          {earlier.map((a) => (
            <ToolRow key={a.id} activity={a} label={display(a.label)} />
          ))}
        </View>
      )}
    </View>
  );
}

/** A running agent's status after its name, dimmed so the name leads. */
function Progress({ activity: a }: { activity: AgentActivity }) {
  const t = useTheme();
  if (a.status !== "running" || !a.progress) return null;
  return (
    <Text numberOfLines={1} style={[styles.progress, { color: t.muted }]}>
      · {a.progress}
    </Text>
  );
}

function WorkingTimer({ started }: { started: number }) {
  useTick(1000);
  return <>{duration(Date.now() - started)}</>;
}

/**
 * A thinking verb that changes every few seconds, so a long pause still looks
 * alive. Only a word that changes in place fades in; a remount shows it as it was.
 */
function ThinkingWord({ seed }: { seed: string }) {
  useTick(1000);
  const word = thinkingWord(seed);
  const first = useRef(word);
  return (
    <WordIn key={word} animate={word !== first.current}>
      <Shine style={styles.stepText}>{word}</Shine>
    </WordIn>
  );
}

function WordIn({ animate, children }: { animate: boolean; children: ReactNode }) {
  const reduced = useReducedMotion();
  const shown = useRef(new Animated.Value(animate ? 0 : 1)).current;
  useEffect(() => {
    if (!animate || reduced) return shown.setValue(1);
    Animated.timing(shown, {
      toValue: 1,
      duration: 280,
      easing: Easing.out(Easing.ease),
      useNativeDriver: true,
    }).start();
  }, [animate, reduced, shown]);
  return (
    <Animated.View
      style={[
        styles.shrink,
        {
          opacity: shown,
          transform: [
            { translateY: shown.interpolate({ inputRange: [0, 1], outputRange: [3, 0] }) },
          ],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}

// The frames of the desktop's .thinking-glyph (src/features/agent-turn/agent-trace.css).
const glyphs: Partial<Record<ChatMessage["provider"], { frames: string[]; ms: number }>> = {
  claude: { frames: [..."·✢✳✶✻✽✻✶✳✢"], ms: 150 },
  codex: { frames: [..."⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏"], ms: 80 },
};

/** Claude's turning asterisk, or a terminal braille spinner for Codex. */
function ThinkingGlyph({ provider }: { provider: ChatMessage["provider"] }) {
  const t = useTheme();
  const glyph = glyphs[provider];
  const reduced = useReducedMotion();
  const tick = useTick(glyph?.ms ?? 1000, !!glyph && !reduced);
  const frame = glyph
    ? reduced
      ? glyph.frames[provider === "claude" ? 2 : 0]!
      : glyph.frames[tick % glyph.frames.length]!
    : "";
  return (
    <Text accessibilityElementsHidden style={[styles.glyph, { color: t.accent }]}>
      {frame}
    </Text>
  );
}

const styles = StyleSheet.create({
  run: { marginTop: 2, marginBottom: 4 },
  runHeading: { flexDirection: "row", alignItems: "center", gap: 7, minHeight: 26 },
  runLabel: { fontSize: 13, flexShrink: 1 },
  runTime: { fontSize: 13, opacity: 0.7, fontVariant: ["tabular-nums"] },
  turned: { transform: [{ rotate: "90deg" }] },
  trace: { marginTop: 6 },
  commentary: { marginTop: 6, marginBottom: 8 },
  step: { flexDirection: "row", alignItems: "center", gap: 7, minHeight: 26 },
  icon: { opacity: 0.75 },
  stepLabel: { fontSize: 13, flex: 1 },
  stepText: { fontSize: 13, flexShrink: 1 },
  mono: { fontFamily: mono, fontSize: 12 },
  progress: { fontSize: 13, opacity: 0.6, flexShrink: 1000 },
  rows: { marginLeft: 21, marginBottom: 4 },
  under: { marginLeft: 21, flexDirection: "row" },
  previews: { gap: 6 },
  detail: { marginLeft: 21, marginTop: 2, marginBottom: 8, maxHeight: 220, borderRadius: 5, padding: 9 },
  detailText: { fontFamily: mono, fontSize: 11, lineHeight: 16 },
  glyph: { width: 14, fontSize: 13, textAlign: "center" },
  shrink: { flexShrink: 1 },
});
