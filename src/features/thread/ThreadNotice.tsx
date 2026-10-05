import { useQueryClient } from "@tanstack/react-query";
import { chatSettled } from "../../../shared/chat-activity";
import type { ChatPending, ChatSummary } from "../../../shared/projects";
import { api } from "../../lib/api";
import { undos } from "../../lib/undo";
import {
  AbandonedStrip,
  HandoffStrip,
  ReturnedStrip,
} from "../handoff/HandoffStrip";
import type { ThreadGoal } from "../../../shared/goal";
import { GoalStrip } from "./GoalStrip";
import {
  LimitStrip,
  SettledStrip,
  StoppedStrip,
  WaitingStrip,
} from "./WaitingStrip";

/** What sits on top of a thread's composer: its goal, while one is set,
 * above the one strip that's most pressing. */
export function ThreadNotice(props: {
  chat: ChatSummary;
  stopped?: ChatPending[];
  leftBehind?: ChatPending[];
  onError: (error: unknown) => void;
  /** Sends `/goal …` as the composer would, on its current settings. */
  onGoal: (
    provider: ThreadGoal["provider"],
    action: "pause" | "resume" | "clear",
  ) => Promise<boolean>;
}) {
  const { chat, onGoal, ...rest } = props;
  const goal = chat.goal && !chat.sentTo && (
    <GoalStrip
      goal={chat.goal}
      running={!!chat.running}
      onAct={async (action) => {
        if (!(await onGoal(chat.goal!.provider, action)))
          throw new Error("The goal command didn't go out.");
      }}
    />
  );
  return (
    <>
      {goal}
      <PressingStrip chat={chat} {...rest} />
    </>
  );
}

/** The strip on top of a thread's composer, the most pressing first: the
 * thread is on another computer or back from one, a usage limit stopped its
 * answer, its agent left work stopped or waiting, or the thread is settled. */
function PressingStrip({
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
    undos.claim([chat.id]);
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
  if (chat.limitResume && !chat.running)
    return (
      <LimitStrip
        plan={chat.limitResume}
        onSet={(on) => changeWork(() => api.setLimitResume(chat.id, on))}
      />
    );
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
  if (chatSettled(chat)) return <SettledStrip onUnsettle={unsettle} />;
  return (
    chat.cameFrom?.abandonedAt && (
      <AbandonedStrip computer={chat.cameFrom.computer} />
    )
  );
}
