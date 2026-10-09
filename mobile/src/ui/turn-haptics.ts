// The thread on screen buzzes as its turn ends or it starts asking; NeedsYou
// covers every other thread and deliberately skips this one.
import { useEffect, useRef } from "react";
import * as Haptics from "expo-haptics";
import { useIsFocused } from "expo-router";
import type { ChatMessage } from "../../../shared/projects";
import type { RemoteChatSummary } from "../../../shared/remote";
import { watchTurn, type TurnWatch } from "../../../shared/turn-feedback";
import { useRemote } from "../remote/RemoteProvider";
import { useForeground } from "./motion";

const buzz = {
  success: Haptics.NotificationFeedbackType.Success,
  error: Haptics.NotificationFeedbackType.Error,
  warning: Haptics.NotificationFeedbackType.Warning,
} as const;

/** Only transitions observed in the foreground's open thread deserve a buzz. */
export function useTurnHaptics(
  id: string,
  summary: RemoteChatSummary | undefined,
  answer: Pick<ChatMessage, "created" | "status"> | undefined,
) {
  const { status, active, call, refresh } = useRemote();
  const focused = useIsFocused();
  const foreground = useForeground();
  const watch = useRef<TurnWatch>(undefined);
  const observing = useRef(false);
  const latestAnswer = useRef(answer);
  useEffect(() => {
    latestAnswer.current = answer;
  }, [answer]);
  // Baseline from a fresh snapshot whenever visibility or connection changes.
  // Cached summaries and background/reconnect catch-up never count as transitions.
  useEffect(() => {
    observing.current = false;
    watch.current = undefined;
    if (status !== "online" || !focused || !foreground) return;
    let live = true;
    void refresh()
      .then((overview) => {
        if (!live || !overview) return;
        const chat = overview.chats.find((c) => c.id === id);
        if (!chat) return;
        watch.current = watchTurn(undefined, {
          running: !!chat.running,
          since: chat.runningSince,
          waiting: !!chat.waiting,
          answer: latestAnswer.current,
        }).watch;
        observing.current = true;
      })
      .catch(() => {});
    return () => {
      live = false;
      observing.current = false;
      watch.current = undefined;
    };
  }, [id, active, call, refresh, status, focused, foreground]);
  const listed = !!summary;
  const running = !!summary?.running;
  const since = summary?.runningSince;
  const waiting = !!summary?.waiting;
  const created = answer?.created;
  const answerStatus = answer?.status;
  useEffect(() => {
    if (!observing.current || !listed) return;
    const step = watchTurn(watch.current, {
      running,
      since,
      waiting,
      answer:
        created === undefined || !answerStatus
          ? undefined
          : { created, status: answerStatus },
    });
    watch.current = step.watch;
    if (step.feedback && focused && foreground)
      void Haptics.notificationAsync(buzz[step.feedback]).catch(() => {});
    // Seeing the same thread again (focus, foreground) changes nothing in `watchTurn`.
  }, [
    listed,
    running,
    since,
    waiting,
    created,
    answerStatus,
    focused,
    foreground,
  ]);
}
