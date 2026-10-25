import { ArrowUpRight } from "lucide-react";
import type { ChatMessage } from "../../../shared/projects";
import type { ProjectFileLink } from "../../../shared/project-file-links";
import { agentName } from "../../../shared/agents";
import { clock } from "../../../shared/waiting";
import { RichText } from "../../ui/RichText";
import { Spinner } from "../../ui/ui";
import { ProviderIcon } from "../agents/ComposerModelPicker";
import { useStartedThreads } from "../agent-turn/StartedThreads";
import "./child-thread-message.css";

const said = { message: undefined, finished: "finished", failed: "failed" };

/**
 * What a thread this one started said to it, as a piece of that thread in a
 * frame that opens it. The body's first paragraph is the agent's line
 * saying who wrote it, which the frame says instead.
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
  return (
    <article
      className="project-message child-thread"
      data-message-id={m.id}
      aria-label={`From ${from?.title ?? m.author}`}
    >
      <div className="child-thread-frame">
        <header>
          {from?.provider && <ProviderIcon provider={from.provider} />}
          <b>{from?.title ?? m.author}</b>
          {state && <span data-state={m.fromChild}>{state}</span>}
          {from && started && (
            <button
              type="button"
              className="child-thread-open"
              onClick={() => started.open(from)}
            >
              Open <ArrowUpRight size={12} />
            </button>
          )}
        </header>
        <div className="child-thread-body">
          <div className="child-thread-who">
            {from?.provider && (
              <>
                <ProviderIcon provider={from.provider} />
                <b>{agentName(from.provider)}</b>
              </>
            )}
            <time>{clock(m.created)}</time>
            {m.unread ? (
              <span
                className="steer-unread muted"
                role="status"
                aria-label="Not read yet"
                title={`Steering ${agentName(m.provider)}: waiting for it to read this`}
              >
                <Spinner size={11} steady />
              </span>
            ) : null}
          </div>
          <div className="markdown">
            <RichText
              text={text}
              projectRoot={projectRoot}
              onOpenFile={onOpenFile}
            />
          </div>
        </div>
      </div>
    </article>
  );
}
