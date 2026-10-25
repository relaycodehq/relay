import { useCallback, useMemo, type ReactNode } from "react";
import { agentName, type AgentProvider } from "../../../shared/agents";
import {
  answerImagePaths,
  localImagePath,
  localVideoPath,
} from "../../../shared/answer-images";
import { stoppedNote } from "../../../shared/agent-trace";
import { agentError } from "../../../shared/agent-error";
import { parseContextReport } from "../../../shared/context-report";
import type { ProjectFileLink } from "../../../shared/project-file-links";
import { turnImages, type ChatMessage } from "../../../shared/projects";
import { api } from "../../lib/api";
import { RichText } from "../../ui/RichText";
import { useAgentSignIn, type SignInPlace } from "../sign-in/useAgentSignIn";
import { WatchNotes } from "../watch/WatchNotes";
import { AgentTurn, type TurnPresentation } from "../agent-turn/AgentTurn";
import { AsyncQuestionCards } from "./AsyncQuestionCards";
import { ImportOfferCard } from "../import-offer/ImportOfferCard";
import { HtmlRenders, type RenderCompose } from "../html-render/HtmlRenders";
import { TurnPreview } from "../browser/TurnPreview";
import { AgentError } from "../agents/AgentError";
import { ContextReportCard } from "../agents/ContextBreakdown";
import { ChangedFilesCard } from "../changes/ChangedFilesCard";
import { AnswerImage, type PreviewImage } from "../images/ImagePreview";
import { AnswerVideo } from "../images/AnswerVideo";
import { AgentImageStrip } from "../images/AgentImageStrip";
import { useImageViewer } from "../images/ImageViewer";
import { MessageActions, RepliesLink } from "./MessageActions";
import { MessageAgentName } from "./MessageAgentName";
import { TipPeek } from "../tips/TipPeek";
import type { QuestionResponse } from "./question-responses";

const hiddenImage = () => null;

/** An image file the agent read or showed in the turn `messageId`, as it is on disk now. */
function readImage(
  chatId: string,
  messageId: string,
  path: string,
  projectRoot: string,
): PreviewImage {
  return {
    key: `${chatId}:${messageId}:${path}`,
    name: path.split("/").at(-1) || path,
    path,
    location: path.startsWith(`${projectRoot}/`)
      ? path.slice(projectRoot.length + 1)
      : path,
    load: () => api.projectChatReadImage(chatId, messageId, path),
    reveal: () => api.revealProjectChatReadImage(chatId, messageId, path),
  };
}

export interface AssistantMessageProps {
  message: ChatMessage;
  chatId: string;
  onReply: (m: ChatMessage) => void;
  /** Absent where a thread can't be forked, like a deep review. */
  onFork?: (m: ChatMessage) => void;
  onChanges: () => void;
  onTurnDiff: (m: ChatMessage, path?: string) => void;
  onRewind: (
    m: ChatMessage,
    paths: string[] | null,
    mode: "revert" | "redo",
    force: boolean,
  ) => Promise<{ conflicts: string[] }>;
  /** Commits what the turn changed; absent where there's no Git to commit to. */
  onCommit?: (m: ChatMessage) => void;
  projectRoot: string;
  onOpenFile: (target: ProjectFileLink) => void;
  replyCount?: number;
  /** See RichText; the lead's summary shows findings this way. */
  inlineCode?: (value: string) => ReactNode | undefined;
  /** Shown below the answer, like a deep review's findings. */
  after?: ReactNode;
  /** Offered when this turn failed on its agent's missing or expired login. */
  signInAt?: SignInPlace;
  /** Manual recovery for the thread's latest resumable connection failure. */
  onResume?: () => void;
  resumeDisabled?: boolean;
  /** Puts a message for the agent in the composer, from a watch note. */
  onSteer?: (text: string) => void;
  /** Puts what a page in the answer composed in the composer that shows. */
  onCompose?: RenderCompose;
  /** Saved question replies, used for delivery status on their original cards. */
  answerMessages?: ReadonlyMap<string, ChatMessage>;
  /** A question-linked follow-up shares the first part's header and activity heading. */
  continuation?: boolean;
  continues?: boolean;
  response?: QuestionResponse;
  responseExpanded?: boolean;
  onToggleResponse?: (id: string, expanded: boolean) => void;
}

/** An agent's answer: its turn, what it wrote, and what it left behind. */
export function AssistantMessage({
  message: m,
  chatId,
  onReply,
  onFork,
  onChanges,
  onTurnDiff,
  onRewind,
  onCommit,
  projectRoot,
  onOpenFile,
  replyCount = 0,
  inlineCode,
  after,
  signInAt,
  onResume,
  resumeDisabled,
  onSteer,
  onCompose,
  answerMessages,
  continuation,
  continues,
  response,
  responseExpanded,
  onToggleResponse,
}: AssistantMessageProps) {
  const activity = useMemo<TurnPresentation | undefined>(
    () =>
      response && {
        summary: continuation ? undefined : response.summary,
        elapsed: response.elapsed,
        waiting: response.waiting,
        expanded:
          responseExpanded ??
          (response.waiting || response.summary.status === "streaming"),
        onToggle: (expanded) =>
          onToggleResponse?.(response.parts[0]!.id, expanded),
      },
    [response, continuation, responseExpanded, onToggleResponse],
  );
  // The answer's own images show in its text; the strip keeps the rest.
  const shown = useMemo(
    () => (m.body ? answerImagePaths(m.body, projectRoot) : []),
    [m.body, projectRoot],
  );
  const read = useMemo(
    () =>
      chatId
        ? [
            ...shown,
            ...turnImages(m).filter((path) => !shown.includes(path)),
          ].map((path) => readImage(chatId, m.id, path, projectRoot))
        : [],
    [chatId, m, projectRoot, shown],
  );
  const { images, open, viewer } = useImageViewer(read);
  const stripImages = images.filter(
    (image) => !image.path || !shown.includes(image.path),
  );
  const answerImage = useCallback(
    (src: string, alt: string) => {
      const video = chatId && localVideoPath(src, projectRoot);
      if (video)
        return (
          <AnswerVideo
            chatId={chatId}
            messageId={m.id}
            path={video}
            alt={alt}
          />
        );
      const path = chatId && localImagePath(src, projectRoot);
      if (!path) return undefined;
      const image = readImage(chatId, m.id, path, projectRoot);
      return (
        <AnswerImage image={image} alt={alt} onOpen={() => open(image.key)} />
      );
    },
    [chatId, m.id, projectRoot, open],
  );
  const failure = m.error ? agentError(m.error) : undefined;
  // A saved synthetic API notice belongs in the error's details. Only an
  // exact duplicate is hidden; real answer text and the saved body stay intact.
  const errorBody =
    m.status === "failed" &&
    failure?.connectionFailed &&
    m.body?.trim() === failure.details;
  const text = errorBody ? "" : m.body;
  // Claude's `/context` tables read as a breakdown; unknown shapes stay markdown.
  const contextReport = useMemo(
    () =>
      m.provider === "claude" && m.status === "complete"
        ? parseContextReport(m.body)
        : null,
    [m.provider, m.status, m.body],
  );
  const answer = text?.trim() ? (
    <RichText
      text={text}
      projectRoot={projectRoot}
      onOpenFile={onOpenFile}
      inlineCode={inlineCode}
      // Main only reads an image once the saved answer names it.
      image={m.status === "streaming" ? hiddenImage : answerImage}
    />
  ) : null;
  return (
    <article
      className="project-message assistant"
      data-message-id={m.id}
      data-response-continuation={continuation || undefined}
      data-response-continues={continues || undefined}
      aria-label={`${m.provider} answer`}
    >
      <header hidden={continuation}>
        <MessageAgentName provider={m.provider} model={m.model} />
        {m.author && <span className="muted">via {m.author}</span>}
        {m.unprompted && (
          <span
            className="muted"
            title="Claude started this turn itself, for example when a background task finished."
          >
            started on its own
          </span>
        )}
      </header>
      <AgentTurn
        message={m}
        presentation={activity}
        projectRoot={projectRoot}
        onOpenFile={onOpenFile}
        onChanges={onChanges}
        images={
          chatId
            ? {
                find: (path) => read.find((i) => i.path === path),
                open: (image) => open(image.key),
              }
            : undefined
        }
        aside={chatId && <TipPeek chatId={chatId} message={m} />}
      />
      {chatId && !!m.renders?.length && (
        <HtmlRenders
          chatId={chatId}
          renders={m.renders}
          onCompose={onCompose}
        />
      )}
      {answer &&
        (contextReport ? (
          <ContextReportCard report={contextReport} raw={answer} />
        ) : (
          answer
        ))}
      {chatId && m.importOffer && (
        <ImportOfferCard
          chatId={chatId}
          messageId={m.id}
          offer={m.importOffer}
          running={m.status === "streaming"}
        />
      )}
      {chatId && m.preview && m.status !== "streaming" && (
        <TurnPreview chatId={chatId} messageId={m.id} preview={m.preview} />
      )}
      {after}
      <AsyncQuestionCards
        message={m}
        chatId={chatId}
        answerMessages={answerMessages}
      />
      {onSteer && (
        <WatchNotes
          agent={agentName(m.provider)}
          chatId={chatId}
          messageId={m.id}
          notes={m.notes}
          projectRoot={projectRoot}
          onOpenFile={onOpenFile}
          onSteer={onSteer}
        />
      )}
      {!!m.changes?.length && m.status !== "streaming" && (
        <ChangedFilesCard
          files={m.changes}
          turn={chatId ? { chatId, messageId: m.id } : undefined}
          onOpen={(path) => onTurnDiff(m, path)}
          onReveal={
            chatId
              ? (path) => api.revealProjectTurnFile(chatId, m.id, path)
              : undefined
          }
          onRewind={
            chatId
              ? (paths, mode, force) => onRewind(m, paths, mode, force)
              : undefined
          }
          onCommit={chatId && onCommit ? () => onCommit(m) : undefined}
        />
      )}
      {/* The images the agent read show once its turn ends, after the answer. */}
      {!!stripImages.length && m.status !== "streaming" && (
        <AgentImageStrip
          chatId={chatId}
          images={stripImages}
          onOpen={(image) => open(image.key)}
        />
      )}
      {viewer}
      <RepliesLink count={replyCount} onOpen={() => onReply(m)} />
      {m.pending && m.status !== "streaming" && (
        <small className="muted">Saved locally · waiting to share</small>
      )}
      {m.status === "cancelled" && (
        <p className="muted" role="status">
          {stoppedNote(m)}
        </p>
      )}
      {m.error && m.status !== "cancelled" && (
        <AgentError
          error={m.error}
          interrupted={
            !!(
              text?.trim() ||
              m.activity?.length ||
              m.trace?.length ||
              m.changes?.length
            )
          }
          onRetry={onResume}
          retryDisabled={resumeDisabled}
        />
      )}
      {signInAt &&
        (m.signIn ||
          (m.provider === "opencode" && failure?.authenticationRequired)) && (
          <SignIn
            provider={m.signIn ?? m.provider}
            place={{ ...signInAt, directory: projectRoot }}
          />
        )}
      {!continues && (
        <MessageActions
          id={m.id}
          text={text}
          readingKey={m.id}
          sent={m.created}
          streamed={m.streamed}
          cost={m.cost}
          pending={m.status === "streaming"}
          onReply={() => onReply(m)}
          onFork={onFork && (() => onFork(m))}
        />
      )}
    </article>
  );
}

function SignIn({
  provider,
  place,
}: {
  provider: AgentProvider;
  place: SignInPlace;
}) {
  const signIn = useAgentSignIn(provider, place);
  if (!signIn.offer) return null;
  return (
    <div className="agent-sign-in">
      {signIn.dialog}
      <button
        className="text-button"
        disabled={signIn.state === "waiting"}
        onClick={() => void signIn.start()}
      >
        {signIn.offer.label}
      </button>
      {signIn.hint && <small className="muted">{signIn.hint}</small>}
    </div>
  );
}
