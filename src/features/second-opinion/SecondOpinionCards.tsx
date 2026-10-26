import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { agentName, type AgentProvider } from "../../../shared/agents";
import { agentError } from "../../../shared/agent-error";
import { errorMessage } from "../../../shared/error-message";
import type { ProjectFileLink } from "../../../shared/project-file-links";
import type { ChatMessage, ChatSummary } from "../../../shared/projects";
import { api } from "../../lib/api";
import { chatKey, fetchChat } from "../../lib/chat-events";
import { RichText } from "../../ui/RichText";
import { ThreadFrame } from "../../ui/ThreadFrame";
import { ProviderIcon } from "../agents/ComposerModelPicker";
import { useStartedThreads } from "../agent-turn/StartedThreads";
import { Folded } from "./Folded";
import { useLatestAsk } from "./second-opinion-ask";
import "./second-opinion.css";

/** Under an answer: the second opinions asked on it, and one being asked. */
export function SecondOpinionCards({
  chatId,
  answer,
  projectRoot,
  onOpenFile,
}: {
  chatId: string;
  answer: ChatMessage;
  projectRoot: string;
  onOpenFile: (target: ProjectFileLink) => void;
}) {
  const view = useStartedThreads();
  const asking = useLatestAsk(chatId, answer.id);
  const opinions =
    view?.threads.filter(
      (c) =>
        c.startedBy?.chatId === chatId &&
        c.startedBy.secondOpinionOn === answer.id &&
        !c.archivedAt,
    ) ?? [];
  if (!opinions.length && !asking) return null;
  return (
    <div className="second-opinions">
      {opinions.map((thread) => (
        <OpinionCard
          key={thread.id}
          thread={thread}
          chatId={chatId}
          checked={answer.provider}
          projectRoot={projectRoot}
          onOpenFile={onOpenFile}
          onOpen={() => view?.open(thread)}
        />
      ))}
      {asking && (
        <ThreadFrame
          icon={
            asking.agent && <ProviderIcon provider={asking.agent.provider} />
          }
          title="Second opinion"
          status={asking.status === "error" ? "failed" : "starting…"}
          failed={asking.status === "error"}
        >
          {asking.status === "error" && (
            <p className="thread-frame-body second-opinion-error" role="alert">
              {errorMessage(asking.error)}
            </p>
          )}
        </ThreadFrame>
      )}
    </div>
  );
}

/** Where a second opinion's thread stands, from its latest answer. */
function standing(thread: ChatSummary, reply: ChatMessage | undefined) {
  if (thread.running) return "working";
  if (reply?.status === "failed") return "failed";
  if (reply?.status === "cancelled") return "stopped";
  // Not answering yet is only its first message on its way.
  return reply?.body.trim() ? "finished" : "working";
}

/** One second opinion: what it says so far, and sending it to the agent it checked. */
function OpinionCard({
  thread,
  chatId,
  checked,
  projectRoot,
  onOpenFile,
  onOpen,
}: {
  thread: ChatSummary;
  chatId: string;
  /** The agent whose answer it checks. */
  checked: AgentProvider;
  projectRoot: string;
  onOpenFile: (target: ProjectFileLink) => void;
  onOpen: () => void;
}) {
  const qc = useQueryClient();
  const history = useQuery({
    queryKey: chatKey(thread.id),
    queryFn: () => fetchChat(qc, thread.id),
  });
  const reply = history.data?.messages
    .filter((m) => m.role === "assistant" && !m.parentId)
    .at(-1);
  const state = standing(thread, reply);
  // Before its first answer, the message it was sent names the agent.
  const agent = thread.provider ?? history.data?.messages[0]?.provider;
  const by = thread.model || (agent && agentName(agent));
  return (
    <ThreadFrame
      icon={agent && <ProviderIcon provider={agent} />}
      title={by ? `Second opinion · ${by}` : "Second opinion"}
      status={state}
      failed={state === "failed"}
      onOpen={onOpen}
    >
      <div className="thread-frame-body">
        <OpinionText
          reply={reply}
          failed={state === "failed"}
          projectRoot={projectRoot}
          onOpenFile={onOpenFile}
        />
      </div>
      {state === "finished" && (
        <SendBack opinionId={thread.id} chatId={chatId} checked={checked} />
      )}
    </ThreadFrame>
  );
}

/** What the second opinion says so far, or why it failed. */
function OpinionText({
  reply,
  failed,
  projectRoot,
  onOpenFile,
}: {
  reply: ChatMessage | undefined;
  failed: boolean;
  projectRoot: string;
  onOpenFile: (target: ProjectFileLink) => void;
}) {
  if (failed)
    return (
      <p className="second-opinion-error" role="alert">
        {reply?.error ? agentError(reply.error).message : "It failed."}
      </p>
    );
  if (!reply?.body.trim())
    return <p className="second-opinion-waiting">Checking the answer…</p>;
  return (
    <Folded lines={6}>
      <div className="markdown">
        <RichText
          text={reply.body}
          projectRoot={projectRoot}
          onOpenFile={onOpenFile}
        />
      </div>
    </Folded>
  );
}

/** Sends the finished opinion to the agent whose answer it checked, once. */
function SendBack({
  opinionId,
  chatId,
  checked,
}: {
  opinionId: string;
  chatId: string;
  checked: AgentProvider;
}) {
  const qc = useQueryClient();
  const lead = useQuery({
    queryKey: chatKey(chatId),
    queryFn: () => fetchChat(qc, chatId),
  });
  const send = useMutation({
    mutationFn: () => api.sendSecondOpinion(opinionId),
  });
  const sent = !!lead.data?.messages.some((m) => m.fromThread === opinionId);
  const who = agentName(checked);
  if (sent)
    return (
      <footer className="second-opinion-send">
        <span>Sent to {who}.</span>
      </footer>
    );
  return (
    <footer className="second-opinion-send">
      <span>
        {send.error ? errorMessage(send.error) : `${who} hasn't seen this.`}
      </span>
      <button
        type="button"
        disabled={send.isPending}
        onClick={() => send.mutate()}
      >
        Send to {who}
      </button>
    </footer>
  );
}
