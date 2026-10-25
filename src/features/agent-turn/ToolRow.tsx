// One tool call's row in an agent's trace, and what a row needs from its
// turn: the subagents' own calls and the images it can open.
import {
  createContext,
  useContext,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import {
  Bot,
  FilePen,
  FileText,
  Globe,
  MessageCircleQuestion,
  Search,
  Terminal,
  Wrench,
} from "lucide-react";
import { PreviewCard } from "@base-ui/react/preview-card";
import type { AgentActivity } from "../../../shared/projects";
import { doneLabel, liveLabel } from "../../../shared/activity-labels";
import { imageRead } from "../../../shared/agent-trace";
import { Spinner } from "../../ui/ui";
import { ImagePeek, PEEK_DELAY } from "../images/ImagePeek";
import { useImageSource, type PreviewImage } from "../images/ImagePreview";
import { isStartThreads, startedIds } from "../../../shared/started-threads";
import {
  askedQuestions,
  isQuestionCall,
} from "../../../shared/asked-questions";
import { AnsweredQuestions } from "./AnsweredQuestions";
import { StartedThreadMarks } from "./StartedThreads";

export const icons = {
  command: Terminal,
  read: FileText,
  file: FilePen,
  search: Search,
  web: Globe,
  agent: Bot,
  tool: Wrench,
} satisfies Record<AgentActivity["kind"], unknown>;

export const iconOf = (a: AgentActivity) =>
  isQuestionCall(a) ? MessageCircleQuestion : icons[a.kind];

/** Each agent call's own tool calls, by the agent call's id, and how to show their paths. */
export const Subagents = createContext({
  calls: new Map<string, AgentActivity[]>(),
  display: (text: string) => text,
});

/** The images the turn read, by path, and how to open one in the viewer. */
export interface ReadImages {
  find: (path: string) => PreviewImage | undefined;
  open: (image: PreviewImage) => void;
}

/** Absent where there's no viewer to open an image in. */
export const TurnImages = createContext<ReadImages | undefined>(undefined);

/** A finished read of an image the viewer can open. */
export function useImageRead(a: AgentActivity) {
  const images = useContext(TurnImages);
  const path = imageRead(a);
  const image = images && path ? images.find(path) : undefined;
  return images && image
    ? { image, open: () => images.open(image) }
    : undefined;
}

/** A read image's row icon: the picture itself, swatch-sized, until it loads the file icon. */
export function ReadIcon({ image }: { image: PreviewImage }) {
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
export function ImageReadPeek({
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
export function Progress({ activity: a }: { activity: AgentActivity }) {
  if (a.status !== "running" || !a.progress) return null;
  return <span className="agent-step-progress">{a.progress}</span>;
}

/** A fold that builds its body the first time it opens; a long run keeps hundreds closed. */
export function Fold({
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

export function ToolRow({
  activity: a,
  label,
  onChanges,
}: {
  activity: AgentActivity;
  label: string;
  onChanges: () => void;
}) {
  const asked = askedQuestions(a);
  // A failed call keeps its own icon, only its line turns red: commands fail as part of the work.
  const Icon = iconOf(a);
  const calls = useContext(Subagents).calls.get(a.id) ?? [];
  const expandable = Boolean(a.detail) || a.kind === "file" || calls.length > 0;
  const read = useImageRead(a);
  if (asked) return <AnsweredQuestions questions={asked} />;
  const heading = (
    <>
      {a.status === "running" ? (
        <Spinner size={14} steady={isQuestionCall(a)} />
      ) : read ? (
        <ReadIcon image={read.image} />
      ) : (
        <Icon size={14} />
      )}
      <span className={a.kind === "command" ? "mono" : undefined}>
        {isQuestionCall(a)
          ? a.status === "running"
            ? liveLabel(a)
            : doneLabel(a)
          : label}
      </span>
      <Progress activity={a} />
      {isStartThreads(a) && <StartedThreadMarks ids={startedIds(a.detail)} />}
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
export function SubagentRows({
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
