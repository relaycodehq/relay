import { useMemo } from "react";
import { clock } from "../../../shared/waiting";
import { agentMentionPattern, agentName } from "../../../shared/agents";
import { parseCodeReferences } from "../../../shared/code-references";
import { onlyImageTokens } from "../../../shared/image-refs";
import type { ProjectFileLink } from "../../../shared/project-file-links";
import type { ChatImage, ChatMessage } from "../../../shared/projects";
import { api } from "../../lib/api";
import { openSchedule } from "../../lib/open-schedule";
import { Spinner } from "../../ui/ui";
import { CodeReferenceList } from "./CodeReferenceChip";
import { BrowserAnnotationChip } from "../images/BrowserAnnotationChip";
import { ImageThumbnail, type PreviewImage } from "../images/ImagePreview";
import { useImageViewer } from "../images/ImageViewer";
import { CopyMessageButton, RepliesLink } from "./MessageActions";
import { useStartedThreads } from "../agent-turn/StartedThreads";
import { pilledImages, sentPills, UserText } from "./UserText";
import type { SentImage } from "./SentPills";
import { SentMemes, useSentMemes } from "../memes/SentMemes";

function userImage(chatId: string, image: ChatImage): PreviewImage {
  return {
    key: `${chatId}:${image.id}`,
    name: image.name,
    load: () => api.projectChatImage(chatId, image.id),
  };
}

export interface UserMessageProps {
  message: ChatMessage;
  chatId: string;
  onReply: (m: ChatMessage) => void;
  projectRoot: string;
  onOpenFile: (target: ProjectFileLink) => void;
  replyCount?: number;
}

/** What someone sent: your prompt or steer, or another thread's agent's message. */
export function UserMessage({
  message: m,
  chatId,
  onReply,
  projectRoot,
  onOpenFile,
  replyCount = 0,
}: UserMessageProps) {
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
  const previews = useMemo(
    () => sentImages.map((sent) => sent.preview),
    [sentImages],
  );
  const { images, open, viewer } = useImageViewer(previews);
  const parsed = useMemo(
    () => (m.body ? parseCodeReferences(m.body) : { refs: [], body: m.body }),
    [m.body],
  );
  // A message of only attachments leaves just the agent mention, or its
  // screenshots' tokens, behind; the images below say it all.
  const said = parsed.body?.replace(agentMentionPattern, "");
  const text = said && onlyImageTokens(said) ? "" : said;
  const memes = useSentMemes(text);
  // A screenshot with a pill in the text needs no second copy below it.
  const pilled = useMemo(() => {
    const ns = text ? pilledImages(text) : new Set<number>();
    return new Set(
      sentImages.flatMap((sent, i) =>
        ns.has(i + 1) ? [sent.preview.key] : [],
      ),
    );
  }, [text, sentImages]);
  const thumbnails = images.filter(
    (image) =>
      !pilled.has(image.key) &&
      !sentImages.some(
        (sent) => sent.preview.key === image.key && sent.image.browser,
      ),
  );
  return (
    <article
      className="project-message user"
      data-message-id={m.id}
      aria-label="Your message"
    >
      <header>
        <MessageAuthor message={m} />
        <time>{clock(m.created)}</time>
        {m.scheduled && (
          <button
            type="button"
            className="message-scheduled"
            title={`Open the “${m.scheduled.name}” schedule`}
            onClick={() => openSchedule(m.scheduled!.id)}
          >
            {m.scheduled.test
              ? "test run of Relay's schedule"
              : "started by Relay's schedule"}
          </button>
        )}
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
        {!!text?.trim() && (
          <CopyMessageButton
            className="message-copy"
            text={text.trim()}
            images={sentImages}
            pills={() => sentPills(text, m.skills, projectRoot)}
            label="Copy message"
          />
        )}
      </header>
      {/* Your images sit above what you wrote. */}
      {!!thumbnails.length && (
        <div className="message-images">
          {thumbnails.map((image) => (
            <ImageThumbnail
              key={image.key}
              image={image}
              onOpen={() => open(image.key)}
            />
          ))}
        </div>
      )}
      {sentImages
        .filter((sent) => sent.image.browser)
        .map(({ image, preview }) => (
          <BrowserAnnotationChip
            key={image.id}
            annotation={image.browser!}
            image={preview}
            onOpen={() => open(preview.key)}
          />
        ))}
      {!!parsed.refs.length && (
        <CodeReferenceList
          references={parsed.refs}
          onOpen={(ref) =>
            onOpenFile({ path: ref.path, line: ref.start, directory: false })
          }
        />
      )}
      {!!text?.trim() && (
        <>
          {!!memes.memes.length && <SentMemes memes={memes.memes} />}
          {!!memes.rest && (
            <UserText
              text={memes.rest}
              skills={m.skills}
              images={sentImages}
              onOpenImage={open}
              projectRoot={projectRoot}
              onOpenFile={onOpenFile}
            />
          )}
        </>
      )}
      {viewer}
      <RepliesLink count={replyCount} onOpen={() => onReply(m)} />
      {m.pending && (
        <small className="muted">Saved locally · waiting to share</small>
      )}
    </article>
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
