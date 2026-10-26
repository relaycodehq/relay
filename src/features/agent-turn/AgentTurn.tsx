import { useNow } from "../../lib/useNow";
// One summary line per turn; under it the commentary, and between lines of it
// the tool calls: one by one while the agent works on them, then grouped by
// what they did (Run).
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Brain,
  ChevronRight,
  Clock3,
  MessageCircleQuestion,
} from "lucide-react";
import type { ChatMessage } from "../../../shared/projects";
import type { ProjectFileLink } from "../../../shared/project-file-links";
import { duration, liveLabel } from "../../../shared/activity-labels";
import {
  groupTrace,
  readTurn,
  thinkingWord,
  turnHeading,
  type TurnHeading,
} from "../../../shared/agent-trace";
import { RichText } from "../../ui/RichText";
import { isStartThreads, startedIds } from "../../../shared/started-threads";
import { isQuestionCall } from "../../../shared/asked-questions";
import { StartedHeading, StartedThreadMarks } from "./StartedThreads";
import { WorkingAgentsHeading } from "./TurnAgents";
import { iconOf, Subagents, TurnImages, type ReadImages } from "./ToolRow";
import { Run } from "./trace-tree/Run";
import { useFoldAway } from "./useFoldAway";
import "./agent-trace.css";
import "./agent-turn.css";

export type { ReadImages } from "./ToolRow";

function WorkingTimer({
  started,
  elapsed = 0,
}: {
  started: number;
  elapsed?: number;
}) {
  const now = useNow(1000);
  return <>{duration(elapsed + now - started)}</>;
}

/** Several backend turns can share one visible response without merging their saved content. */
export interface TurnPresentation {
  /** Only the first part draws the response's combined heading. */
  summary?: ChatMessage;
  elapsed: number;
  waiting: boolean;
  expanded: boolean;
  onToggle: (expanded: boolean) => void;
}

export function AgentTurn({
  message,
  projectRoot,
  onOpenFile,
  onChanges,
  images,
  open,
  aside,
  presentation,
}: {
  message: ChatMessage;
  projectRoot: string;
  onOpenFile: (target: ProjectFileLink) => void;
  onChanges: () => void;
  images?: ReadImages;
  /** Stays open once it ends, where the run is what the reader came for. */
  open?: boolean;
  /** Sits at the right end of the live thinking line. */
  aside?: ReactNode;
  presentation?: TurnPresentation;
}) {
  const turn = readTurn(message);
  const { live, entries, shown, calls, thinking } = turn;
  // Open while the turn runs; fold back once it ends
  // unless the reader opened or closed it themselves.
  const [toggled, setToggled] = useState<boolean | undefined>(
    open || undefined,
  );
  const expanded = presentation?.expanded ?? toggled ?? live;
  const fold = useFoldAway(expanded);
  const headingMessage = presentation?.summary ?? message;
  const headingTurn = presentation?.summary ? readTurn(headingMessage) : turn;
  if (!live && !entries.length && !presentation?.summary) return null;
  const headingLive = headingTurn.live;
  const continuation = !!presentation && !presentation.summary;
  const Container = continuation ? "div" : "details";
  const root = projectRoot.replace(/\/+$/, "") + "/";
  const display = (text: string) => text.split(root).join("");
  const ended = headingMessage.ended ?? headingMessage.created;
  const heading = turnHeading(headingMessage, expanded, headingTurn);
  // Folded, the turn still shows the threads it started.
  const starts = expanded
    ? []
    : (headingMessage.trace ?? []).flatMap((e) =>
        e.kind === "activity" && isStartThreads(e.activity) ? [e.activity] : [],
      );
  const startedBy = starts.map((a) => startedIds(a.detail));
  const startedIn = startedBy.every(Boolean)
    ? startedBy.flatMap((ids) => ids!)
    : undefined;
  const waiting = !!presentation?.waiting;
  const label = headingText(heading, waiting, display, headingMessage.id);
  // Expanded, the header is the whole run and stays still; the one live row
  // below it is what moves. Folded, the header stands in for that row.
  const HeaderIcon = headingIconOf(heading, waiting);
  const headingIcon = HeaderIcon ? (
    <HeaderIcon size={14} />
  ) : (
    <ThinkingGlyph provider={message.provider} />
  );
  const headingLabel = (
    <span
      className={
        headingLive && !expanded && typeof label === "string"
          ? "live-shine"
          : undefined
      }
    >
      {label}
    </span>
  );
  const plainHeading =
    headingTurn.live ||
    !headingTurn.activity.some((a) => a.kind === "agent") ? (
      <>
        {headingIcon}
        {headingLabel}
      </>
    ) : (
      // Agents it sent off can work on after the turn ends.
      <WorkingAgentsHeading
        activity={headingTurn.activity}
        dropped={headingMessage.traceDropped}
        icon={headingIcon}
        label={headingLabel}
      />
    );
  return (
    <Container
      className={`agent-activity${live ? " live" : ""}${continuation ? " continuation" : ""}`}
      open={continuation ? undefined : expanded || fold.folding}
      onToggle={
        continuation
          ? undefined
          : (event) => {
              // React setting `open` fires toggle too; only a click changes the state.
              const opened = event.currentTarget.hasAttribute("open");
              if (opened !== expanded) {
                if (presentation) presentation.onToggle(opened);
                else setToggled(opened);
              }
            }
      }
    >
      {!continuation && (
        <summary className="agent-run-heading">
          {!headingLive && starts.length > 0 ? (
            <StartedHeading ids={startedIn} label={headingLabel}>
              {plainHeading}
            </StartedHeading>
          ) : (
            plainHeading
          )}
          <span className="agent-run-time">
            {headingLive ? (
              <WorkingTimer
                started={headingMessage.created}
                elapsed={presentation?.elapsed}
              />
            ) : headingMessage.ended ? (
              <>
                {headingMessage.status === "cancelled" ? "Stopped after " : ""}
                {duration(
                  (presentation?.elapsed ?? 0) + ended - headingMessage.created,
                )}
              </>
            ) : null}
          </span>
          {/* While the turn runs its own icon stays, the threads after it. */}
          {headingLive && starts.length > 0 && (
            <StartedThreadMarks ids={startedIn} />
          )}
          <ChevronRight size={13} className="agent-run-chevron" />
        </summary>
      )}
      {(expanded || fold.folding) && (entries.length > 0 || thinking) && (
        <Subagents.Provider value={{ calls, display }}>
          <TurnImages.Provider value={images}>
            <div
              className="agent-trace"
              aria-label="Local agent activity"
              ref={fold.ref}
            >
              <TraceParts
                shown={shown}
                live={live}
                projectRoot={projectRoot}
                onOpenFile={onOpenFile}
                onChanges={onChanges}
              />
              {/* The line keeps its height while a call runs, so each call
                doesn't shrink the trace and jolt the thread pinned below. */}
              {live && !message.body && (
                <div className={`agent-step agent-thinking${thinking ? "" : " reserved"}`}>
                  <div className="agent-step-heading">
                    {thinking && (
                      <>
                        <ThinkingGlyph provider={message.provider} />
                        <ThinkingWord seed={message.id} />
                      </>
                    )}
                    {aside}
                  </div>
                </div>
              )}
            </div>
          </TurnImages.Provider>
        </Subagents.Provider>
      )}
    </Container>
  );
}

/** The trace between lines of commentary; while the turn runs, its last batch is open. */
function TraceParts({
  shown,
  live,
  projectRoot,
  onOpenFile,
  onChanges,
}: {
  shown: ReturnType<typeof readTurn>["shown"];
  live: boolean;
  projectRoot: string;
  onOpenFile: (target: ProjectFileLink) => void;
  onChanges: () => void;
}) {
  // Batches that come in after the trace first drew grow in.
  const [drawn, setDrawn] = useState(false);
  useEffect(() => {
    if (live) setDrawn(true);
  }, [live]);
  return groupTrace(shown).map((part, index, parts) =>
    part.kind === "commentary" ? (
      <div className="agent-commentary" key={part.id}>
        <RichText
          text={part.text}
          projectRoot={projectRoot}
          onOpenFile={onOpenFile}
        />
      </div>
    ) : (
      <Run
        key={part.id}
        calls={part.activity}
        live={
          live &&
          index === parts.length - 1 &&
          !isQuestionCall(part.activity[0]!)
        }
        only={parts.every((p) => p === part || p.kind === "commentary")}
        arrived={drawn}
        onChanges={onChanges}
      />
    ),
  );
}

/** What the heading says: a word for what the turn is doing, or the live call. */
function headingText(
  heading: TurnHeading,
  waiting: boolean,
  display: (text: string) => string,
  seed: string,
): ReactNode {
  if (waiting) return "Waiting for your answer";
  switch (heading.kind) {
    case "working":
      return "Working for";
    case "call":
      return display(liveLabel(heading.activity));
    case "writing":
      return "Writing";
    case "thinking":
      return <ThinkingWord seed={seed} />;
    case "done":
      return heading.text;
  }
}

/** The heading's icon; none while thinking, where the agent's own glyph turns instead. */
function headingIconOf(heading: TurnHeading, waiting: boolean) {
  if (waiting) return MessageCircleQuestion;
  switch (heading.kind) {
    case "working":
      return Clock3;
    case "call":
      return iconOf(heading.activity);
    case "done":
      return heading.last ? iconOf(heading.last) : Brain;
    default:
      return null;
  }
}

/**
 * A thinking verb that changes every few seconds, so a long pause still looks
 * alive. The line comes and goes around every call; picking by turn and time
 * keeps the word from changing each time it does.
 */
function ThinkingWord({ seed }: { seed: string }) {
  const now = useNow(1000);
  const word = thinkingWord(seed, now);
  const first = useRef(word);
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
