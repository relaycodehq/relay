import { useMemo } from "react";
import { ChevronLeft } from "lucide-react";
import type { ProjectFileLink } from "../../../shared/project-file-links";
import type { ChatMessage } from "../../../shared/projects";
import type { SecondOpinionAsked as Asked } from "../../../shared/second-opinion";
import { clock } from "../../../shared/waiting";
import { api } from "../../lib/api";
import { RichText } from "../../ui/RichText";
import { useStartedThreads } from "../agent-turn/StartedThreads";
import { ImageThumbnail, type PreviewImage } from "../images/ImagePreview";
import { useImageViewer } from "../images/ImageViewer";
import { Folded } from "./Folded";
import "./second-opinion.css";

/**
 * Atop a second opinion's thread, in place of the prompt its agent got:
 * what it was asked, like a `/btw` question atop its side thread, and the
 * way back to the thread whose answer it checks.
 */
export function SecondOpinionAsked({
  message: m,
  asked: { question, answer },
  chatId,
  projectRoot,
  onOpenFile,
}: {
  message: ChatMessage;
  asked: Asked;
  chatId: string;
  projectRoot: string;
  onOpenFile: (target: ProjectFileLink) => void;
}) {
  const view = useStartedThreads();
  const thread = view?.threads.find((c) => c.id === chatId);
  const lead = view?.threads.find((c) => c.id === thread?.startedBy?.chatId);
  const text = (markdown: string) => (
    <div className="markdown">
      <RichText
        text={markdown}
        projectRoot={projectRoot}
        onOpenFile={onOpenFile}
      />
    </div>
  );
  return (
    <>
      <h2 className="reply-heading second-opinion-heading">
        Second opinion
        {lead && (
          <button
            type="button"
            className="second-opinion-back"
            onClick={() => view?.open(lead)}
          >
            <ChevronLeft size={13} />
            {lead.title}
          </button>
        )}
      </h2>
      <article
        className="project-message user side-question"
        data-message-id={m.id}
        aria-label="What the second opinion was asked"
      >
        <header>
          <strong>You</strong>
          <time>{clock(m.created)}</time>
        </header>
        <div className="side-question-body second-opinion-asked">
          <AskedImages message={m} chatId={chatId} />
          {question && (
            <>
              <h3>Question</h3>
              {text(question)}
            </>
          )}
          <h3>Answer</h3>
          <Folded lines={4}>{text(answer)}</Folded>
        </div>
      </article>
    </>
  );
}

/** The screenshots sent with the question, which its agent got too. */
function AskedImages({
  message: m,
  chatId,
}: {
  message: ChatMessage;
  chatId: string;
}) {
  const previews = useMemo<PreviewImage[]>(
    () =>
      (m.images ?? []).map((image) => ({
        key: `${chatId}:${image.id}`,
        name: image.name,
        load: () => api.projectChatImage(chatId, image.id),
      })),
    [chatId, m.images],
  );
  const { images, open, viewer } = useImageViewer(previews);
  if (!images.length) return null;
  return (
    <div className="message-images">
      {images.map((image) => (
        <ImageThumbnail
          key={image.key}
          image={image}
          onOpen={() => open(image.key)}
        />
      ))}
      {viewer}
    </div>
  );
}
