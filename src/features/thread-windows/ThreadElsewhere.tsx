import { useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { SquareArrowOutUpRight } from "lucide-react";
import {
  threadOrder,
  type ChatMessage,
  type ChatSummary,
} from "../../../shared/projects";
import { readTurn } from "../../../shared/agent-trace";
import { agentName } from "../../../shared/agents";
import { plural } from "../../../shared/activity-labels";
import { took } from "../../../shared/subagents";
import { inputBlocksThread } from "../../../shared/thread-state";
import { preview } from "../../../shared/thread-news";
import { api } from "../../lib/api";
import { chatKey, fetchChat } from "../../lib/chat-events";
import { useShortcut, useShortcutLabel } from "../../lib/shortcuts";
import { useNow } from "../../lib/useNow";
import { PeekCalls } from "../handoff/RemotePeek";
import "../handoff/handoff.css";
import "../agent-turn/subagents.css";
import "./thread-windows.css";

/** Calls the picture of the window holds, so it doesn't grow as they come. */
const SHOWN_CALLS = 4;

/** What the latest answer in the main conversation is doing, or did. */
function latestTurn(messages: ChatMessage[]) {
  const answer = [...messages]
    .sort(threadOrder)
    .reverse()
    .find((m) => m.role === "assistant" && !m.parentId);
  if (!answer) return;
  const { activity, live } = readTurn(answer);
  const said = [...(answer.trace ?? [])]
    .reverse()
    .find((e) => e.kind === "commentary" && e.text.trim());
  return {
    answer,
    live,
    calls: activity.length,
    recent: activity.slice(-SHOWN_CALLS),
    says: said?.kind === "commentary" ? said.text.trim() : undefined,
  };
}

function heading(chat: ChatSummary, failed: boolean) {
  if (inputBlocksThread(chat)) return "Waiting for you in its own window";
  if (chat.running) return "Working in its own window";
  if (failed) return "Stopped in its own window";
  return "In its own window";
}

/**
 * Where a thread popped out of the main window was: a small picture of its
 * window, saying what its agent is doing. Clicking it brings the window up.
 * There's no composer here, so the thread is never live in two places.
 */
export function ThreadElsewhere({
  chat,
  projectName,
  hidden,
  onError,
}: {
  chat: ChatSummary;
  projectName: string;
  hidden?: boolean;
  onError: (error: unknown) => void;
}) {
  const qc = useQueryClient();
  const now = useNow(1000);
  const history = useQuery({
    queryKey: chatKey(chat.id),
    queryFn: () => fetchChat(qc, chat.id),
    refetchOnMount: "always",
  });
  const turn = useMemo(
    () => latestTurn(history.data?.messages ?? []),
    [history.data],
  );
  const keys = useShortcutLabel("thread-window");
  const bringBack = () => void api.returnThreadWindow(chat.id).catch(onError);
  useShortcut("thread-window", true, bringBack);
  const failed = turn?.answer.status === "failed";
  const live = !!chat.running && !inputBlocksThread(chat);
  const meta = [
    turn?.answer.provider && agentName(turn.answer.provider),
    turn?.answer.model?.name,
    turn?.calls ? plural(turn.calls, "call") : undefined,
    live && chat.runningSince && took(now - chat.runningSince),
  ]
    .filter(Boolean)
    .join(" · ");
  const quote = live
    ? turn?.says && preview(turn.says, 300)
    : failed
      ? turn?.answer.error?.split("\n")[0]
      : turn?.answer.body && preview(turn.answer.body, 300);
  return (
    <div className="workspace-column" hidden={hidden}>
      <div className="thread-elsewhere">
        <button
          type="button"
          className="thread-elsewhere-window"
          title="Show its window"
          onClick={() =>
            void api.openThreadWindow(chat.projectId, chat.id).catch(onError)
          }
        >
          <span className="thread-elsewhere-bar" aria-hidden="true">
            <span className="thread-elsewhere-lights">
              <i />
              <i />
              <i />
            </span>
            <span className="thread-elsewhere-title">
              {projectName} <span>/</span> <b>{chat.title}</b>
            </span>
            <SquareArrowOutUpRight
              size={13}
              className="thread-elsewhere-raise"
            />
          </span>
          <span className="remote-peek">
            <span className="subagents-title">
              <b>{heading(chat, failed)}</b>
              {meta && <span>{meta}</span>}
            </span>
            {quote && (
              <span
                className={
                  live
                    ? "subagents-now"
                    : "remote-peek-quote thread-elsewhere-quote"
                }
              >
                {quote}
              </span>
            )}
            {!!turn?.recent.length && (
              <PeekCalls
                calls={turn.recent}
                live={live}
                className="thread-elsewhere-calls"
              />
            )}
          </span>
        </button>
        <p className="thread-elsewhere-foot">
          <button type="button" className="text-button" onClick={bringBack}>
            Bring it back here
          </button>
          {keys && <kbd>{keys}</kbd>}
        </p>
      </div>
    </div>
  );
}
