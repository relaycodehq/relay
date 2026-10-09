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

/**
 * `summary` is the thread as the live list has it; `answer` its latest
 * answer. Only changes seen while connected count: going offline forgets how
 * it looked, and so does each fresh overview (on every connect and refresh),
 * so what happened while away arrives without a buzz.
 */
export function useTurnHaptics(
  summary: RemoteChatSummary | undefined,
  answer: Pick<ChatMessage, "created" | "status"> | undefined,
) {
  const { status, overview } = useRemote();
  const focused = useIsFocused();
  const foreground = useForeground();
  const watch = useRef<TurnWatch>(undefined);
  // A fresh overview brings new `projects`; pushed thread lists keep them.
  const projects = overview?.projects;
  const seenProjects = useRef(projects);
  const listed = !!summary;
  const running = !!summary?.running;
  const since = summary?.runningSince;
  const waiting = !!summary?.waiting;
  const created = answer?.created;
  const answerStatus = answer?.status;
  useEffect(() => {
    if (status !== "online" || !listed || seenProjects.current !== projects) {
      watch.current = undefined;
      seenProjects.current = projects;
      if (status !== "online" || !listed) return;
    }
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
      void Haptics.notificationAsync(buzz[step.feedback]);
    // Seeing the same thread again (focus, foreground) changes nothing in `watchTurn`.
  }, [status, projects, listed, running, since, waiting, created, answerStatus, focused, foreground]);
}
