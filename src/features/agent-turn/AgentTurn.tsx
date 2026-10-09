// One summary line per turn, and a flat list of tool rows named by what they
// touched.
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactElement,
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
import { PreviewCard } from "@base-ui/react/preview-card";
import {
  isImagePath,
  type AgentActivity,
  type ChatMessage,
} from "../../../shared/projects";
import type { ProjectFileLink } from "../../../shared/project-file-links";
import {
  doneLabel,
  duration,
  liveLabel,
  summarizeActivity,
} from "../../../shared/activity-labels";
import {
  batchHead,
  groupTrace,
  readTurn,
  thinkingWord,
  turnHeading,
} from "../../../shared/agent-trace";
import { Spinner } from "../../ui/ui";
import { RichText } from "../../ui/RichText";
import { ImagePeek, PEEK_DELAY } from "../images/ImagePeek";
import { useImageSource, type PreviewImage } from "../images/ImagePreview";
import { isStartThreads, StartedChip, startedIds } from "./StartedThreads";
import "./agent-trace.css";
import "./agent-turn.css";

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

/** The images the turn read, by path, and how to open one in the viewer. */
export interface ReadImages {
  find: (path: string) => PreviewImage | undefined;
  open: (image: PreviewImage) => void;
}

/** Absent where there's no viewer to open an image in. */
const TurnImages = createContext<ReadImages | undefined>(undefined);

/** A finished read of an image the viewer can open. */
function useImageRead(a: AgentActivity) {
  const images = useContext(TurnImages);
  const image =
    images &&
    a.kind === "read" &&
    a.status === "complete" &&
    isImagePath(a.label)
      ? images.find(a.label)
      : undefined;
  return images && image
    ? { image, open: () => images.open(image) }
    : undefined;
}

/** A read image's row icon: the picture itself, swatch-sized, until it loads the file icon. */
function ReadIcon({ image }: { image: PreviewImage }) {
  const { data: source } = useImageSource(image);
  return source ? (
    <img className="agent-step-thumb" src={source} alt="" />
  ) : (
    <FileText size={14} />
  );
}

/** A read image's picture grown above its row, once it has loaded. */
function ReadPeek({
  image,
  onOpen,
}: {
  image: PreviewImage;
  onOpen?: () => void;
}) {
  const { data: source } = useImageSource(image);
  return source ? <ImagePeek src={source} onOpen={onOpen} /> : null;
}

/** A row that grows its read image above it on hover, as a sent image's pill does. */
function ImageReadPeek({
  image,
  onOpen,
  trigger,
  children,
}: {
  image?: PreviewImage;
  onOpen?: () => void;
  trigger: ReactElement;
  children: ReactNode;
}) {
  const peek = useRef<PreviewCard.Root.Actions>(null);
  return (
    <PreviewCard.Root actionsRef={peek}>
      <PreviewCard.Trigger delay={PEEK_DELAY} closeDelay={0} render={trigger}>
        {children}
      </PreviewCard.Trigger>
      {image && (
        <ReadPeek
          image={image}
          onOpen={
            onOpen &&
            (() => {
              peek.current?.close();
              onOpen();
            })
          }
        />
      )}
    </PreviewCard.Root>
  );
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
  const read = useImageRead(a);
  const heading = (
    <>
      {a.status === "running" ? (
        <Spinner size={14} />
      ) : read ? (
        <ReadIcon image={read.image} />
      ) : (
        <Icon size={14} />
      )}
      <span className={a.kind === "command" ? "mono" : undefined}>{label}</span>
      <Progress activity={a} />
      {isStartThreads(a) && <StartedChip ids={startedIds(a.detail)} />}
    </>
  );
  if (!expandable)
    return (
      <div className={`agent-step ${a.status}`}>
        {read ? (
          <ImageReadPeek
            image={read.image}
            onOpen={read.open}
            trigger={
              <button
                type="button"
                className="agent-step-heading agent-step-open"
                onClick={read.open}
              />
            }
          >
            {heading}
          </ImageReadPeek>
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
      {calls.length > 0 && <SubagentRows calls={calls} onChanges={onChanges} />}
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
  images,
  open,
}: {
  message: ChatMessage;
  projectRoot: string;
  onOpenFile: (target: ProjectFileLink) => void;
  onChanges: () => void;
  images?: ReadImages;
  /** Stays open once it ends, where the run is what the reader came for. */
  open?: boolean;
}) {
  const turn = readTurn(message);
  const { live, entries, shown, calls, thinking } = turn;
  // Open while the turn runs; fold back once it ends
  // unless the reader opened or closed it themselves.
  const [toggled, setToggled] = useState<boolean | undefined>(
    open || undefined,
  );
  const expanded = toggled ?? live;
  if (!live && !entries.length) return null;
  const root = projectRoot.replace(/\/+$/, "") + "/";
  const display = (text: string) => text.split(root).join("");
  const ended = message.ended ?? message.created;
  const heading = turnHeading(message, expanded, turn);
  // Folded, the turn still shows the threads it started.
  const starts = expanded
    ? []
    : (message.trace ?? []).flatMap((e) =>
        e.kind === "activity" && isStartThreads(e.activity) ? [e.activity] : [],
      );
  const startedBy = starts.map((a) => startedIds(a.detail));
  const label =
    heading.kind === "working" ? (
      "Working for"
    ) : heading.kind === "call" ? (
      display(liveLabel(heading.activity))
    ) : heading.kind === "writing" ? (
      "Writing"
    ) : heading.kind === "thinking" ? (
      <ThinkingWord seed={message.id} />
    ) : (
      heading.text
    );
  // Expanded, the header is the whole run and stays still; the one live row
  // below it is what moves. Folded, the header stands in for that row.
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
        {starts.length > 0 && (
          <StartedChip
            ids={
              startedBy.every(Boolean)
                ? startedBy.flatMap((ids) => ids!)
                : undefined
            }
          />
        )}
        <ChevronRight size={13} className="agent-run-chevron" />
      </summary>
      {expanded && (entries.length > 0 || thinking) && (
        <Subagents.Provider value={{ calls, display }}>
          <TurnImages.Provider value={images}>
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
          </TurnImages.Provider>
        </Subagents.Provider>
      )}
    </details>
  );
}

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

/** Claude's turning asterisk, or a terminal braille spinner for the other agents. */
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
  const { head, earlier } = batchHead(activity);
  const running = head.status === "running";
  const Icon = icons[head.kind];
  const calls = useContext(Subagents).calls.get(head.id) ?? [];
  const folded = earlier.length > 0 || calls.length > 0;
  // With nothing folded behind it, an image's row opens the image instead.
  const read = useImageRead(head);
  return (
    <div className={`agent-batch ${head.status}`}>
      <ImageReadPeek
        image={read?.image}
        onOpen={read?.open}
        trigger={
          <button
            type="button"
            className="agent-step-heading agent-batch-head"
            aria-expanded={folded ? open : undefined}
            disabled={!folded && !read}
            onClick={folded ? () => setOpen(!open) : read?.open}
          />
        }
      >
        <span className="agent-batch-row" title={display(head.label)}>
          {read ? <ReadIcon image={read.image} /> : <Icon size={14} />}
          <span className={running ? "live-shine" : undefined}>
            {display(running ? liveLabel(head) : doneLabel(head))}
          </span>
          <Progress activity={head} />
        </span>
        {folded && <ChevronRight size={13} className="agent-batch-chevron" />}
      </ImageReadPeek>
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
