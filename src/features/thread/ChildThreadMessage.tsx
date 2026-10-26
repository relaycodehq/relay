import type { ChatMessage } from "../../../shared/projects";
import type { ProjectFileLink } from "../../../shared/project-file-links";
import { agentName } from "../../../shared/agents";
import { clock } from "../../../shared/waiting";
import { RichText } from "../../ui/RichText";
import { Spinner } from "../../ui/ui";
import { ThreadFrame } from "../../ui/ThreadFrame";
import { ProviderIcon } from "../agents/ComposerModelPicker";
import { useStartedThreads } from "../agent-turn/StartedThreads";
import "./child-thread-message.css";

const said = { message: undefined, finished: "finished", failed: "failed" };

/**
 * What a thread this one started said to it, as a piece of that thread in a
 * frame that opens it. The body's first paragraph is the agent's line
 * saying who wrote it, which the frame says instead. A finished thread's
 * report is for the lead to read and sum up, so only its frame shows.
 */
export function ChildThreadMessage({
  message: m,
  projectRoot,
  onOpenFile,
}: {
  message: ChatMessage;
  projectRoot: string;
  onOpenFile: (target: ProjectFileLink) => void;
}) {
  const started = useStartedThreads();
  const from = started?.threads.find((c) => c.id === m.fromThread);
  const at = m.body.indexOf("\n\n");
  const text = at < 0 ? m.body : m.body.slice(at + 2);
  const state = said[m.fromChild!];
  const reportOnly = m.fromChild === "finished";
  const unread = m.unread ? (
    <span
      className="steer-unread muted"
      role="status"
      aria-label="Not read yet"
      title={`Steering ${agentName(m.provider)}: waiting for it to read this`}
    >
      <Spinner size={11} steady />
    </span>
  ) : null;
  return (
    <article
      className="project-message child-thread"
      data-message-id={m.id}
      aria-label={`From ${from?.title ?? m.author}`}
    >
      <ThreadFrame
        icon={from?.provider && <ProviderIcon provider={from.provider} />}
        title={from?.title ?? m.author ?? ""}
        status={state}
        failed={m.fromChild === "failed"}
        onOpen={from && started ? () => started.open(from) : undefined}
        aside={reportOnly ? unread : undefined}
      >
        {!reportOnly && (
          <div className="thread-frame-body">
            <div className="child-thread-who">
              {from?.provider && (
                <>
                  <ProviderIcon provider={from.provider} />
                  <b>{agentName(from.provider)}</b>
                </>
              )}
              <time>{clock(m.created)}</time>
              {unread}
            </div>
            <div className="markdown">
              <RichText
                text={text}
                projectRoot={projectRoot}
                onOpenFile={onOpenFile}
              />
            </div>
          </div>
        )}
      </ThreadFrame>
    </article>
  );
}
