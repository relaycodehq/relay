import { useQueryClient } from "@tanstack/react-query";
import { chatSettled } from "../../../shared/chat-activity";
import type { ChatPending, ChatSummary } from "../../../shared/projects";
import { api } from "../../lib/api";
import { HandoffStrip, ReturnedStrip } from "../handoff/HandoffStrip";
import { SettledStrip, StoppedStrip, WaitingStrip } from "./WaitingStrip";

/** The strip on top of a thread's composer, the most pressing first: the
 * thread is on another computer or back from one, its agent left work
 * stopped or waiting, or the thread is settled. */
export function ThreadNotice({
  chat,
  stopped,
  leftBehind,
  onError,
}: {
  chat: ChatSummary;
  stopped?: ChatPending[];
  /** Background work the agent waits on that the subagents indicator doesn't show. */
  leftBehind?: ChatPending[];
  onError: (error: unknown) => void;
}) {
  const qc = useQueryClient();
  /** The thread list shows what's left of the background work. */
  async function changeWork(change: () => Promise<unknown>) {
    try {
      await change();
    } catch (e) {
      onError(e);
      throw e;
    } finally {
      void qc.invalidateQueries({ queryKey: ["project-chats"] });
    }
  }
  const unsettle = async () => {
    qc.setQueriesData<ChatSummary[]>({ queryKey: ["project-chats"] }, (list) =>
      list?.map((c) => (c.id === chat.id ? { ...c, settledAt: undefined } : c)),
    );
    try {
      await api.triageProjectChat(chat.id, { kind: "unsettle" });
    } catch (e) {
      onError(e);
    } finally {
      void qc.invalidateQueries({ queryKey: ["project-chats"] });
    }
  };
  if (chat.sentTo) return <HandoffStrip chat={chat} onError={onError} />;
  if (chat.cameFrom?.returnedAt)
    return <ReturnedStrip computer={chat.cameFrom.computer} />;
  if (stopped?.length)
    return (
      <StoppedStrip
        items={stopped}
        onResolve={(action) =>
          changeWork(() => api.resolveStoppedWork(chat.id, action))
        }
      />
    );
  if (leftBehind?.length)
    return (
      <WaitingStrip
        pending={leftBehind}
        onStop={(item) =>
          changeWork(() => api.stopProjectChatPending(chat.id, item.id))
        }
      />
    );
  return chatSettled(chat) && <SettledStrip onUnsettle={unsettle} />;
}
