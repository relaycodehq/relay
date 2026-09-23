// Adapted from T3 Code's MessagesTimeline activity group: one summary line per turn,
// and a flat list of tool rows named by what they touched.
import { useEffect, useRef, useState, type ReactNode } from "react";
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
import type {
  AgentActivity,
  AgentTrace,
  ChatMessage,
} from "../../shared/projects";
import type { ProjectFileLink } from "../lib/project-file-links";
import { RichText, Spinner } from "./ui";
import "./agent-trace.css";

function duration(ms: number) {
  const seconds = Math.max(0, ms / 1000);
  return seconds < 10
    ? `${seconds.toFixed(1)}s`
    : seconds < 60
      ? `${Math.floor(seconds)}s`
      : `${Math.floor(seconds / 60)}m ${Math.floor(seconds % 60)}s`;
}

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

const plural = (count: number, one: string, many = `${one}s`) =>
  `${count} ${count === 1 ? one : many}`;

const summaries: Record<AgentActivity["kind"], (count: number) => string> = {
  read: (n) => `Read ${plural(n, "file")}`,
  file: (n) => `Edited ${plural(n, "file")}`,
  command: (n) => `Ran ${plural(n, "command")}`,
  search: (n) => `Searched code ${plural(n, "time")}`,
  web: (n) => `Searched the web ${plural(n, "time")}`,
  agent: (n) => `Ran ${plural(n, "agent")}`,
  tool: (n) => `Used ${plural(n, "tool")}`,
};

/** "Read 3 files, ran 2 commands, and edited 1 file" */
export function summarizeActivity(activity: AgentActivity[]) {
  const groups = new Map<AgentActivity["kind"], Set<string>>();
  for (const a of activity) {
    const seen = groups.get(a.kind) ?? new Set();
    // Repeated reads or edits of one file count once; commands and tools count every call.
    seen.add(a.kind === "read" || a.kind === "file" ? a.label : a.id);
    groups.set(a.kind, seen);
  }
  const parts = [...groups].map(([kind, seen], index) => {
    const text = summaries[kind](seen.size);
    return index === 0 ? text : text.charAt(0).toLowerCase() + text.slice(1);
  });
  if (parts.length < 3) return parts.join(" and ");
  return `${parts.slice(0, -1).join(", ")}, and ${parts.at(-1)}`;
}

const baseName = (path: string) => path.split("/").filter(Boolean).at(-1) ?? path;

const commandWrappers = new Set([
  "sudo",
  "env",
  "time",
  "nice",
  "nohup",
  "exec",
  "command",
  "npx",
  "pnpx",
  "bunx",
]);
const commandSetup = new Set([
  "cd",
  "pushd",
  "popd",
  "export",
  "unset",
  "set",
  "source",
  ".",
  "true",
]);

/** The program a command line is about: "cd app && npx vitest run" is
 *  vitest, and Codex's "/bin/zsh -lc 'rg foo'" is rg. */
export function programName(command: string): string | undefined {
  const shell = command.match(
    /^\s*(?:\S*\/)?(?:ba|z|fi)?sh\s+-\w*c\s+(['"])([\s\S]*)\1\s*$/,
  );
  if (shell) return programName(shell[2]!);
  for (const segment of command.split(/&&|\|\||[;|\n]/)) {
    const words = segment.trim().split(/\s+/);
    while (
      words[0] &&
      (commandWrappers.has(words[0]) || /^\w+=/.test(words[0]))
    )
      words.shift();
    const word = words[0]?.replace(/^["'(]+|["')]+$/g, "");
    if (!word || commandSetup.has(word)) continue;
    return word.split("/").at(-1) || word;
  }
}

/** The past-tense line for a finished call, e.g. "Ran rg" or "Read AgentTurn.tsx". */
function doneLabel(a: AgentActivity) {
  switch (a.kind) {
    case "command":
      return `${a.status === "failed" ? "Failed" : "Ran"} ${programName(a.label) ?? "command"}`;
    case "read":
      return `Read ${baseName(a.label)}`;
    case "file":
      return `Edited ${baseName(a.label)}`;
    case "search":
      return `Searched for ${a.label}`;
    case "web":
      return "Searched the web";
    case "agent":
    case "tool":
      return a.label;
  }
}

/** The present-tense line shown while a call runs, e.g. "Reading AgentTurn.tsx". */
function liveLabel(a: AgentActivity) {
  switch (a.kind) {
    case "command":
      return `Running ${programName(a.label) ?? "command"}`;
    case "read":
      return `Reading ${baseName(a.label)}`;
    case "file":
      return `Editing ${baseName(a.label)}`;
    case "search":
      return `Searching for ${a.label}`;
    case "web":
      return "Searching the web";
    case "agent":
      return a.label;
    case "tool":
      return a.label;
  }
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
  const expandable = Boolean(a.detail) || a.kind === "file";
  const heading = (
    <>
      {a.status === "running" ? <Spinner size={14} /> : <Icon size={14} />}
      <span className={a.kind === "command" ? "mono" : undefined}>{label}</span>
    </>
  );
  if (!expandable)
    return (
      <div className={`agent-step ${a.status}`}>
        <div className="agent-step-heading">{heading}</div>
      </div>
    );
  return (
    <Fold
      className={`agent-step ${a.status}`}
      summary={<summary className="agent-step-heading">{heading}</summary>}
    >
      {a.detail && <pre>{a.detail}</pre>}
      {a.kind === "file" && (
        <button onClick={onChanges}>Open working changes</button>
      )}
    </Fold>
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
}: {
  message: ChatMessage;
  projectRoot: string;
  onOpenFile: (target: ProjectFileLink) => void;
  onChanges: () => void;
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
  const activity = entries.flatMap((e) =>
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
  const HeaderIcon = live
    ? expanded
      ? Clock3
      : current
        ? icons[current.kind]
        : null
    : (icons[activity.at(-1)?.kind ?? "tool"] ?? Brain);
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
        <div className="agent-trace" aria-label="Local agent activity">
          {groupTrace(entries).map((part, index, parts) =>
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
      )}
    </details>
  );
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
  return (
    <div className={`agent-batch ${head.status}`}>
      <button
        type="button"
        className="agent-step-heading agent-batch-head"
        aria-expanded={earlier.length ? open : undefined}
        disabled={!earlier.length}
        onClick={() => setOpen(!open)}
      >
        <span className="agent-batch-row" title={display(head.label)}>
          <Icon size={14} />
          <span className={running ? "live-shine" : undefined}>
            {display(running ? liveLabel(head) : doneLabel(head))}
          </span>
        </span>
        {earlier.length > 0 && (
          <ChevronRight size={13} className="agent-batch-chevron" />
        )}
      </button>
      {open && (
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
