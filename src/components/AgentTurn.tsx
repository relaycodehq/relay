// Adapted from T3 Code's MessagesTimeline activity group: one summary line per turn,
// and a flat list of tool rows named by what they touched.
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
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
} from "lucide-react";
import {
  isImagePath,
  type AgentActivity,
  type AgentTrace,
  type ChatMessage,
} from "../../shared/projects";
import type { ProjectFileLink } from "../lib/project-file-links";
import {
  doneLabel,
  duration,
  liveLabel,
  summarizeActivity,
} from "../../shared/activity-labels";
import { RichText, Spinner } from "./ui";
import "./agent-trace.css";

export { programName, summarizeActivity } from "../../shared/activity-labels";

function WorkingTimer({ started }: { started: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return <>{duration(now - started)}</>;
}

const icons = {
  command: Terminal,
  read: FileText,
  file: FilePen,
  search: Search,
  web: Globe,
  agent: Bot,
  tool: Wrench,
} satisfies Record<AgentActivity["kind"], unknown>;

/** Each agent call's own tool calls, by the agent call's id, and how to show their paths. */
const Subagents = createContext({
  calls: new Map<string, AgentActivity[]>(),
  display: (text: string) => text,
});

/** Opens an image the turn read in the preview dialog; absent where there's none to open. */
const OpenImage = createContext<((path: string) => void) | undefined>(
  undefined,
);

/** The path of a finished read that can open in the image preview. */
function useImageRead(a: AgentActivity) {
  const open = useContext(OpenImage);
  return open && a.kind === "read" && a.status === "complete" && isImagePath(a.label)
    ? () => open(a.label)
    : undefined;
}

/** A running agent's status after its name, dimmed so the name leads. */
function Progress({ activity: a }: { activity: AgentActivity }) {
  if (a.status !== "running" || !a.progress) return null;
  return <span className="agent-step-progress">{a.progress}</span>;
}

/** A fold that builds its body the first time it opens; a long run keeps hundreds closed. */
function Fold({
  className,
  summary,
  children,
}: {
  className: string;
  summary: ReactNode;
  children: ReactNode;
}) {
  const [opened, setOpened] = useState(false);
  return (
    <details
      className={className}
      onToggle={(event) => {
        if (event.currentTarget.open) setOpened(true);
      }}
    >
      {summary}
      {opened && children}
    </details>
  );
}

function ToolRow({
  activity: a,
  label,
  onChanges,
}: {
  activity: AgentActivity;
  label: string;
  onChanges: () => void;
}) {
  // A failed call looks like any other: commands fail as part of the work.
  const Icon = icons[a.kind];
  const calls = useContext(Subagents).calls.get(a.id) ?? [];
  const expandable = Boolean(a.detail) || a.kind === "file" || calls.length > 0;
  const openImage = useImageRead(a);
  const heading = (
    <>
      {a.status === "running" ? <Spinner size={14} /> : <Icon size={14} />}
      <span className={a.kind === "command" ? "mono" : undefined}>{label}</span>
      <Progress activity={a} />
    </>
  );
  if (!expandable)
    return (
      <div className={`agent-step ${a.status}`}>
        {openImage ? (
          <button
            type="button"
            className="agent-step-heading agent-step-open"
            onClick={openImage}
          >
            {heading}
          </button>
        ) : (
          <div className="agent-step-heading">{heading}</div>
        )}
      </div>
    );
  return (
    <Fold
      className={`agent-step ${a.status}`}
      summary={<summary className="agent-step-heading">{heading}</summary>}
    >
      {calls.length > 0 && (
        <SubagentRows calls={calls} onChanges={onChanges} />
      )}
      {a.detail && <pre>{a.detail}</pre>}
      {a.kind === "file" && (
        <button onClick={onChanges}>Open working changes</button>
      )}
    </Fold>
  );
}

/** What a subagent did, under its agent row. */
function SubagentRows({
  calls,
  onChanges,
}: {
  calls: AgentActivity[];
  onChanges: () => void;
}) {
  const { display } = useContext(Subagents);
  return (
    <div className="agent-group-rows">
      {calls.map((c) => (
        <ToolRow
          key={c.id}
          activity={c}
          label={display(c.label)}
          onChanges={onChanges}
        />
      ))}
    </div>
  );
}

/** A run of tool calls between two commentary lines, folded into "Ran 6 commands". */
function ActivityGroup({
  activity,
  display,
  onChanges,
}: {
  activity: AgentActivity[];
  display: (text: string) => string;
  onChanges: () => void;
}) {
  const kinds = new Set(activity.map((a) => a.kind));
  const Icon = kinds.size === 1 ? icons[activity[0]!.kind] : Wrench;
  return (
    <Fold
      className="agent-step agent-group"
      summary={
        <summary className="agent-step-heading">
          <Icon size={14} />
          <span>{summarizeActivity(activity)}</span>
        </summary>
      }
    >
      <div className="agent-group-rows">
        {activity.map((a) => (
          <ToolRow
            key={a.id}
            activity={a}
            label={display(a.label)}
            onChanges={onChanges}
          />
        ))}
      </div>
    </Fold>
  );
}

export function AgentTurn({
  message,
  projectRoot,
  onOpenFile,
  onChanges,
  onOpenImage,
}: {
  message: ChatMessage;
  projectRoot: string;
  onOpenFile: (target: ProjectFileLink) => void;
  onChanges: () => void;
  onOpenImage?: (path: string) => void;
}) {
  const live = message.status === "streaming";
  // Open while the turn runs, like T3 Code's work log; fold back once it ends
  // unless the reader opened or closed it themselves.
  const [toggled, setToggled] = useState<boolean>();
  const expanded = toggled ?? live;
  const entries: AgentTrace[] =
    message.trace ??
    (message.activity ?? []).map((activity) => ({
      kind: "activity" as const,
      id: activity.id,
      activity,
    }));
  if (!live && !entries.length) return null;
  const root = projectRoot.replace(/\/+$/, "") + "/";
  const display = (text: string) => text.split(root).join("");
  const { shown, calls } = nestSubagents(entries);
  // Claude's own calls; a subagent's are counted by its agent row.
  const activity = shown.flatMap((e) =>
    e.kind === "activity" ? [e.activity] : [],
  );
  const current = live
    ? [...activity].reverse().find((a) => a.status === "running")
    : undefined;
  const thinking = live && !current && !message.body;
  const ended = message.ended ?? message.created;
  const label = live ? (
    expanded ? (
      "Working for"
    ) : current ? (
      display(liveLabel(current))
    ) : message.body ? (
      "Writing"
    ) : (
      <ThinkingWord seed={message.id} />
    )
  ) : (
    summarizeActivity(activity) || "Thought"
  );
  // Expanded, the header is the whole run and stays still; the one live row
  // below it is what moves. Folded, the header stands in for that row.
  const last = activity.at(-1);
  const HeaderIcon = live
    ? expanded
      ? Clock3
      : current
        ? icons[current.kind]
        : null
    : last
      ? icons[last.kind]
      : Brain;
  return (
    <details
      className={`agent-activity${live ? " live" : ""}`}
      open={expanded}
      onToggle={(event) => {
        // React setting `open` fires toggle too; only a click changes the state.
        if (event.currentTarget.open !== expanded)
          setToggled(event.currentTarget.open);
      }}
    >
      <summary className="agent-run-heading">
        {HeaderIcon ? (
          <HeaderIcon size={14} />
        ) : (
          <ThinkingGlyph provider={message.provider} />
        )}
        <span
          className={
            live && !expanded && typeof label === "string"
              ? "live-shine"
              : undefined
          }
        >
          {label}
        </span>
        <span className="agent-run-time">
          {live ? (
            <WorkingTimer started={message.created} />
          ) : message.ended ? (
            <>
              {message.status === "cancelled" ? "Stopped after " : ""}
              {duration(ended - message.created)}
            </>
          ) : null}
        </span>
        <ChevronRight size={13} className="agent-run-chevron" />
      </summary>
      {expanded && (entries.length > 0 || thinking) && (
        <Subagents.Provider value={{ calls, display }}>
          <OpenImage.Provider value={onOpenImage}>
          <div className="agent-trace" aria-label="Local agent activity">
            {groupTrace(shown).map((part, index, parts) =>
              part.kind === "commentary" ? (
                <div className="agent-commentary" key={part.id}>
                  <RichText
                    text={part.text}
                    projectRoot={projectRoot}
                    onOpenFile={onOpenFile}
                  />
                </div>
              ) : live && index === parts.length - 1 ? (
                <OpenBatch
                  key={part.id}
                  activity={part.activity}
                  display={display}
                  onChanges={onChanges}
                />
              ) : part.activity.length === 1 ? (
                <ToolRow
                  key={part.id}
                  activity={part.activity[0]!}
                  label={display(part.activity[0]!.label)}
                  onChanges={onChanges}
                />
              ) : (
                <ActivityGroup
                  key={part.id}
                  activity={part.activity}
                  display={display}
                  onChanges={onChanges}
                />
              ),
            )}
            {/* The line keeps its height while a call runs, so each call
                doesn't shrink the trace and jolt the thread pinned below. */}
            {live && !message.body && (
              <div className="agent-step agent-thinking">
                <div className="agent-step-heading">
                  {thinking && (
                    <>
                      <ThinkingGlyph provider={message.provider} />
                      <ThinkingWord seed={message.id} />
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
          </OpenImage.Provider>
        </Subagents.Provider>
      )}
    </details>
  );
}

/** Takes the calls subagents made out of the trace, keyed by the agent call that ran them. */
function nestSubagents(entries: AgentTrace[]) {
  const ids = new Set(entries.map((e) => e.id));
  const calls = new Map<string, AgentActivity[]>();
  const shown = entries.filter((e) => {
    if (e.kind !== "activity") return true;
    const parent = e.activity.parentId;
    // An orphan, its agent row dropped from a full trace, stays in line.
    if (!parent || !ids.has(parent)) return true;
    calls.set(parent, [...(calls.get(parent) ?? []), e.activity]);
    return false;
  });
  return { shown, calls };
}

type TracePart =
  | { kind: "commentary"; id: string; text: string }
  | { kind: "run"; id: string; activity: AgentActivity[] };

/** Consecutive tool calls become one run; commentary splits them. */
function groupTrace(entries: AgentTrace[]) {
  const parts: TracePart[] = [];
  for (const entry of entries) {
    if (entry.kind === "commentary") {
      parts.push(entry);
      continue;
    }
    const last = parts.at(-1);
    if (last?.kind === "run") last.activity.push(entry.activity);
    else parts.push({ kind: "run", id: entry.id, activity: [entry.activity] });
  }
  return parts;
}

const thinkingWords = [
  "Thinking",
  "Pondering",
  "Mulling it over",
  "Noodling",
  "Ruminating",
  "Percolating",
  "Cogitating",
  "Brewing",
  "Tinkering",
  "Musing",
  "Scheming",
  "Untangling",
  "Marinating",
  "Puzzling",
  "Chewing on it",
  "Connecting dots",
];

const hash = (text: string) =>
  [...text].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7) >>> 0;
/** The turn's word for this six-second window; the same on every remount. */
const thinkingWord = (seed: string) =>
  thinkingWords[
    hash(`${seed}:${Math.floor(Date.now() / 6000)}`) % thinkingWords.length
  ]!;

/**
 * A thinking verb that changes every few seconds, so a long pause still looks
 * alive. The line comes and goes around every call; picking by turn and time
 * keeps the word from changing each time it does.
 */
function ThinkingWord({ seed }: { seed: string }) {
  const [word, setWord] = useState(() => thinkingWord(seed));
  const first = useRef(word);
  useEffect(() => {
    const timer = setInterval(() => setWord(thinkingWord(seed)), 1000);
    return () => clearInterval(timer);
  }, [seed]);
  // Only a word that changes in place fades in; a remount shows it as it was.
  return (
    <span
      key={word}
      className={word === first.current ? undefined : "agent-word"}
    >
      <span className="live-shine">{word}</span>
    </span>
  );
}

/** Claude's turning asterisk, or a terminal braille spinner for Codex. */
function ThinkingGlyph({ provider }: { provider: ChatMessage["provider"] }) {
  return <span className={`thinking-glyph ${provider}`} aria-hidden />;
}

/**
 * The batch still being worked on: one row names the latest call, and the
 * ones before it fold behind that row. It gets its "Ran 6 commands" summary
 * only once commentary or the end of the turn closes it.
 */
function OpenBatch({
  activity,
  display,
  onChanges,
}: {
  activity: AgentActivity[];
  display: (text: string) => string;
  onChanges: () => void;
}) {
  const [open, setOpen] = useState(false);
  const head =
    [...activity].reverse().find((a) => a.status === "running") ??
    activity.at(-1)!;
  const earlier = activity.filter((a) => a !== head);
  const running = head.status === "running";
  const Icon = icons[head.kind];
  const calls = useContext(Subagents).calls.get(head.id) ?? [];
  const folded = earlier.length > 0 || calls.length > 0;
  // With nothing folded behind it, an image's row opens the image instead.
  const openImage = useImageRead(head);
  return (
    <div className={`agent-batch ${head.status}`}>
      <button
        type="button"
        className="agent-step-heading agent-batch-head"
        aria-expanded={folded ? open : undefined}
        disabled={!folded && !openImage}
        onClick={folded ? () => setOpen(!open) : openImage}
      >
        <span className="agent-batch-row" title={display(head.label)}>
          <Icon size={14} />
          <span className={running ? "live-shine" : undefined}>
            {display(running ? liveLabel(head) : doneLabel(head))}
          </span>
          <Progress activity={head} />
        </span>
        {folded && (
          <ChevronRight size={13} className="agent-batch-chevron" />
        )}
      </button>
      {/* The live agent's own calls first; the batch's earlier calls fold behind it. */}
      {open && calls.length > 0 && (
        <SubagentRows calls={calls} onChanges={onChanges} />
      )}
      {open && earlier.length > 0 && (
        <div className="agent-group-rows">
          {earlier.map((a) => (
            <ToolRow
              key={a.id}
              activity={a}
              label={display(a.label)}
              onChanges={onChanges}
            />
          ))}
        </div>
      )}
    </div>
  );
}
