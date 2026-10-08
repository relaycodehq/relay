import { memo, useCallback, useMemo, useState, type ReactNode } from "react";
import { Reply } from "lucide-react";
import { clock } from "../../../shared/waiting";
import {
  agentMentionPattern,
  agentName,
  type AgentProvider,
} from "../../../shared/agents";
import {
  answerImagePaths,
  localImagePath,
} from "../../../shared/answer-images";
import { parseCodeReferences } from "../../../shared/code-references";
import { parseContextReport } from "../../../shared/context-report";
import { WatchNotes } from "../watch/WatchNotes";
import type { ProjectFileLink } from "../../../shared/project-file-links";
import {
  turnImages,
  type ChatImage,
  type ChatMessage,
} from "../../../shared/projects";
import { api } from "../../lib/api";
import { onlyImageTokens } from "../../../shared/image-refs";
import { AgentTurn } from "../agent-turn/AgentTurn";
import { AsyncQuestionCards } from "./AsyncQuestionCards";
import { AgentError } from "../agents/AgentError";
import { ContextReportCard } from "../agents/ContextBreakdown";
import { ChangedFilesCard } from "../changes/ChangedFilesCard";
import { CodeReferenceList } from "./CodeReferenceChip";
import { CompactionRow } from "./CompactionRow";
import { SessionReloadRow } from "./SessionReloadRow";
import { WorktreeCommandRow } from "./WorktreeCommandRow";
import {
  AnswerImage,
  ImageThumbnail,
  useWorkingImages,
  type PreviewImage,
} from "../images/ImagePreview";
import { ImageViewer } from "../images/ImageViewer";
import { CopyMessageButton, MessageActions } from "./MessageActions";
import { MessageAgentName } from "./MessageAgentName";
import { useStartedThreads } from "../agent-turn/StartedThreads";
import { Spinner } from "../../ui/ui";
import { RichText } from "../../ui/RichText";
import { pilledImages, UserText, type SentImage } from "./UserText";
import { signInOffer } from "./sign-in-offer";
import "./thread.css";
function userImage(chatId: string, image: ChatImage): PreviewImage {
  return {
    key: `${chatId}:${image.id}`,
    name: image.name,
    load: () => api.projectChatImage(chatId, image.id),
  };
}
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
/** One-line divider where another agent took over, with the outgoing agent's note behind it. */
function HandoffRow({
  message: m,
  projectRoot,
  onOpenFile,
}: {
  message: ChatMessage;
  projectRoot: string;
  onOpenFile: (target: ProjectFileLink) => void;
}) {
  const [open, setOpen] = useState(false);
  const { from, to, computer, byRelay } = m.handoff!;
  const switched = computer
    ? `Handoff note for ${computer}`
    : `Switched from ${agentName(from)} to ${agentName(to)}${byRelay ? ` · ${agentName(from)} couldn't write a note, Relay did` : ""}`;
  const note = m.status === "complete" && m.body.trim();
  return (
    <div
      className="agent-handoff"
      data-message-id={m.id}
      data-status={m.status}
      role="status"
    >
      <div className="context-compaction">
        <span>
          {m.status === "streaming"
            ? `${agentName(from)} is writing a handoff note for ${computer ?? agentName(to)}…`
            : note
              ? switched
              : `${switched} · no handoff note`}
        </span>
        {note && (
          <button
            type="button"
            className="text-button"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? "Hide note" : "Show note"}
          </button>
        )}
      </div>
      {note && open && (
        <div className="agent-handoff-note">
          <RichText
            text={m.body}
            projectRoot={projectRoot}
            onOpenFile={onOpenFile}
          />
        </div>
      )}
    </div>
  );
}
export const Message = memo(function Message({
  message: m,
  chatId,
  onReply,
  onFork,
  onChanges,
  onTurnDiff,
  onRewind,
  projectRoot,
  onOpenFile,
  replyCount = 0,
  inlineCode,
  after,
  onSignIn,
  onSteer,
  onRerunSetup,
}: {
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
  projectRoot: string;
  onOpenFile: (target: ProjectFileLink) => void;
  replyCount?: number;
  /** See RichText; the lead's summary shows findings this way. */
  inlineCode?: (value: string) => ReactNode | undefined;
  /** Shown below the answer, like a deep review's findings. */
  after?: ReactNode;
  /** Offered when this turn failed on its agent's missing or expired login. */
  onSignIn?: (provider: AgentProvider) => Promise<boolean>;
  /** Puts a message for the agent in the composer, from a watch note. */
  onSteer?: (text: string) => void;
  /** Offered on the thread's latest worktree setup, when it didn't get through. */
  onRerunSetup?: (m: ChatMessage) => Promise<void>;
}) {
  /** The key of the image open in the viewer. */
  const [viewing, setViewing] = useState<string>();
  // The answer's own images show in its text; the strip keeps the rest.
  const shown = useMemo(
    () =>
      m.role === "assistant" && m.body
        ? answerImagePaths(m.body, projectRoot)
        : [],
    [m.role, m.body, projectRoot],
  );
  const sentImages = useMemo<SentImage[]>(
    () =>
      chatId
        ? (m.images ?? []).map((image) => ({
            image,
            preview: userImage(chatId, image),
          }))
        : [],
    [chatId, m.images],
  );
  const allImages = useMemo(
    () =>
      chatId
        ? [
            ...sentImages.map((sent) => sent.preview),
            ...[
              ...shown,
              ...turnImages(m).filter((path) => !shown.includes(path)),
            ].map((path) => readImage(chatId, m.id, path, projectRoot)),
          ]
        : [],
    [chatId, m, projectRoot, shown, sentImages],
  );
  const parsed = useMemo(() => {
    if (m.role !== "user" || !m.body) return { refs: [], body: m.body };
    const code = parseCodeReferences(m.body);
    return { refs: code.refs, body: code.body };
  }, [m.role, m.body]);
  // A message of only attachments leaves just the agent mention, or its
  // screenshots' tokens, behind; the images below say it all.
  const said =
    m.role === "user"
      ? parsed.body?.replace(agentMentionPattern, "")
      : parsed.body;
  const text = m.role === "user" && said && onlyImageTokens(said) ? "" : said;
  const images = useWorkingImages(allImages, viewing);
  // A screenshot with a pill in the text needs no second copy below it.
  const pilled = useMemo(() => {
    const ns =
      m.role === "user" && text ? pilledImages(text) : new Set<number>();
    return new Set(
      sentImages.flatMap((sent, i) =>
        ns.has(i + 1) ? [sent.preview.key] : [],
      ),
    );
  }, [m.role, text, sentImages]);
  const stripImages = images.filter(
    (image) =>
      !pilled.has(image.key) && (!image.path || !shown.includes(image.path)),
  );
  const answerImage = useCallback(
    (src: string, alt: string) => {
      const path = chatId && localImagePath(src, projectRoot);
      if (!path) return undefined;
      const image = readImage(chatId, m.id, path, projectRoot);
      return (
        <AnswerImage
          image={image}
          alt={alt}
          onOpen={() => setViewing(image.key)}
        />
      );
    },
    [chatId, m.id, projectRoot],
  );
  const viewingIndex = images.findIndex((image) => image.key === viewing);
  // Claude's `/context` tables read as a breakdown; unknown shapes stay markdown.
  const contextReport = useMemo(
    () =>
      m.role === "assistant" &&
      m.provider === "claude" &&
      m.status === "complete"
        ? parseContextReport(m.body)
        : null,
    [m.role, m.provider, m.status, m.body],
  );
  const answer = text?.trim() && m.role === "assistant" && (
    <RichText
      text={text}
      projectRoot={projectRoot}
      onOpenFile={onOpenFile}
      inlineCode={inlineCode}
      // Main only reads an image once the saved answer names it.
      image={m.status === "streaming" ? hiddenImage : answerImage}
    />
  );
  if (m.handoff)
    return (
      <HandoffRow
        message={m}
        projectRoot={projectRoot}
        onOpenFile={onOpenFile}
      />
    );
  if (m.reload) return <SessionReloadRow message={m} reload={m.reload} />;
  if (m.worktreeCommand)
    return (
      <WorktreeCommandRow
        message={m}
        onRerun={onRerunSetup && (() => onRerunSetup(m))}
      />
    );
  if (m.compaction)
    return (
      <CompactionRow
        message={m}
        projectRoot={projectRoot}
        onOpenFile={onOpenFile}
      />
    );
  return (
    <article
      className={`project-message ${m.role}`}
      data-message-id={m.id}
      aria-label={m.role === "user" ? "Your message" : `${m.provider} answer`}
    >
      <header>
        {m.role === "user" ? (
          <MessageAuthor message={m} />
        ) : (
          <MessageAgentName provider={m.provider} model={m.model} />
        )}
        {m.role === "user" && <time>{clock(m.created)}</time>}
        {m.unread && (
          <span
            className="steer-unread muted"
            role="status"
            aria-label="Not read yet"
            title={`Steering ${agentName(m.provider)}: waiting for it to read this`}
          >
            <Spinner size={11} steady />
          </span>
        )}
        {m.author && m.role === "assistant" && (
          <span className="muted">via {m.author}</span>
        )}
        {m.unprompted && (
          <span
            className="muted"
            title="Claude started this turn itself, for example when a background task finished."
          >
            started on its own
          </span>
        )}
        {m.role === "user" && !!text?.trim() && (
          <CopyMessageButton
            className="message-copy"
            text={text.trim()}
            label="Copy message"
          />
        )}
      </header>
      {m.role === "assistant" && (
        <AgentTurn
          message={m}
          projectRoot={projectRoot}
          onOpenFile={onOpenFile}
          onChanges={onChanges}
          images={
            chatId
              ? {
                  find: (path) => allImages.find((i) => i.path === path),
                  open: (image) => setViewing(image.key),
                }
              : undefined
          }
        />
      )}
      {!!parsed.refs.length && (
        <CodeReferenceList
          references={parsed.refs}
          onOpen={(ref) =>
            onOpenFile({ path: ref.path, line: ref.start, directory: false })
          }
        />
      )}
      {text?.trim() ? (
        m.role === "user" ? (
          <UserText text={text} images={sentImages} onOpenImage={setViewing} />
        ) : contextReport ? (
          <ContextReportCard report={contextReport} raw={answer} />
        ) : (
          answer
        )
      ) : null}
      {after}
      {m.role === "assistant" && (
        <AsyncQuestionCards message={m} chatId={chatId} />
      )}
      {m.role === "assistant" && onSteer && (
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
        />
      )}
      {/* The images the agent read show once its turn ends, after the answer. */}
      {!!stripImages.length && m.status !== "streaming" && (
        <div className="message-images">
          {stripImages.map((image) => (
            <ImageThumbnail
              key={image.key}
              image={image}
              onOpen={() => setViewing(image.key)}
            />
          ))}
        </div>
      )}
      {viewingIndex >= 0 && (
        <ImageViewer
          images={images}
          index={viewingIndex}
          onIndex={(index) => setViewing(images[index].key)}
          onClose={() => setViewing(undefined)}
        />
      )}
      {!!replyCount && (
        <button className="thread-replies-link" onClick={() => onReply(m)}>
          <Reply size={13} />
          {replyCount} {replyCount === 1 ? "reply" : "replies"}
        </button>
      )}
      {m.pending && m.status !== "streaming" && (
        <small className="muted">Saved locally · waiting to share</small>
      )}
      {m.status === "cancelled" && (
        <p className="muted" role="status">
          Stopped · partial output kept
        </p>
      )}
      {m.error && m.status !== "cancelled" && <AgentError error={m.error} />}
      {onSignIn && m.signIn && (
        <SignIn provider={m.signIn} onSignIn={onSignIn} />
      )}
      {m.role === "assistant" && (
        <MessageActions
          text={text}
          readingKey={m.id}
          sent={m.created}
          pending={m.status === "streaming"}
          onReply={() => onReply(m)}
          onFork={onFork && (() => onFork(m))}
        />
      )}
    </article>
  );
});
function SignIn({
  provider,
  onSignIn,
}: {
  provider: AgentProvider;
  onSignIn: (provider: AgentProvider) => Promise<boolean>;
}) {
  const offer = signInOffer(provider);
  const [state, setState] = useState<"idle" | "waiting" | "busy" | "failed">(
    "idle",
  );
  const start = () => {
    setState("waiting");
    onSignIn(provider).then(
      (typed) => setState(typed ? "idle" : "busy"),
      () => setState(offer.via === "relay" ? "failed" : "busy"),
    );
  };
  return (
    <div className="agent-sign-in">
      <button
        className="text-button"
        disabled={state === "waiting" && offer.via === "relay"}
        onClick={start}
      >
        {offer.label}
      </button>
      {state === "waiting" && offer.via === "relay" && (
        <small className="muted">Finish signing in in your browser.</small>
      )}
      {state === "busy" && offer.via === "terminal" && (
        <small className="muted">
          The terminal is busy. Run <code>{offer.command}</code> there once it's
          free.
        </small>
      )}
      {state === "failed" && offer.via === "relay" && (
        <small className="muted">
          Signing in didn't finish. Try again, or use Settings → Agents.
        </small>
      )}
    </div>
  );
}

/** Who wrote a message; another thread's agent opens that thread on a click. */
function MessageAuthor({ message: m }: { message: ChatMessage }) {
  const started = useStartedThreads();
  const from = m.fromThread
    ? started?.threads.find((c) => c.id === m.fromThread)
    : undefined;
  if (!from || !started) return <strong>{m.author ?? "You"}</strong>;
  return (
    <button
      type="button"
      className="message-author-link"
      title={`Open ${from.title}`}
      onClick={() => started.open(from)}
    >
      {m.author}
    </button>
  );
}
