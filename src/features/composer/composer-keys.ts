import type { KeyboardEvent } from "react";
import {
  altSends,
  sendAction,
  type RunningSendAction,
  type SendKey,
} from "../../lib/send-key";
import { matches } from "../../lib/shortcuts";
import { noteUsed } from "../../lib/used";
import { effortStep, quickStep } from "../quick-switch/effort-shortcut";
import type { ComposerSendOptions } from "./useComposerSend";

export interface ComposerSubmitOptions extends Omit<
  ComposerSendOptions,
  "compact"
> {
  /** Sends with the opposite of the compact checkbox's current pick. */
  flipCompact?: boolean;
}

interface ComposerKeys {
  recall: (event: KeyboardEvent<HTMLElement>) => boolean;
  menus: readonly ((event: KeyboardEvent<HTMLElement>) => boolean)[];
  /** The guess shown over the empty draft: Tab takes it, Escape puts it away. */
  ghost?: { take: () => void; dismiss: () => void };
  /** Takes back a queued message when the caret allows it. */
  editQueued?: () => boolean;
  alternateCompact: boolean;
  sendKey: SendKey;
  runningAction: RunningSendAction;
  send: (options?: ComposerSubmitOptions) => Promise<void>;
  nextThread: () => void;
  stepEffort: (step: -1 | 1) => void;
  stepQuick?: (step: -1 | 1) => void;
}

/** Recall and open menus take keys before composer actions or sending. */
export function composerKeys(
  event: KeyboardEvent<HTMLElement>,
  context: ComposerKeys,
) {
  if (context.recall(event)) return;
  if (context.menus.some((handle) => handle(event))) return;
  if (event.nativeEvent.isComposing) return;
  if (
    context.ghost &&
    event.key === "Tab" &&
    !(event.shiftKey || event.altKey || event.metaKey || event.ctrlKey)
  ) {
    event.preventDefault();
    context.ghost.take();
    return;
  }
  if (context.ghost && event.key === "Escape") context.ghost.dismiss();
  if (
    context.editQueued &&
    !event.repeat &&
    matches("edit-queued", event) &&
    context.editQueued()
  ) {
    event.preventDefault();
    noteUsed("shortcut:edit-queued");
    return;
  }
  // With mod+Enter sending, Alt also matches Send-then-new-thread. The
  // alternate compact action shown beside Send takes precedence.
  if (context.alternateCompact && altSends(event, context.sendKey)) {
    event.preventDefault();
    void context.send({ flipCompact: true });
    return;
  }
  if (!event.repeat && matches("send-new-thread", event)) {
    event.preventDefault();
    noteUsed("shortcut:send-new-thread");
    void context.send({
      steer: context.runningAction === "steer",
      after: context.nextThread,
    });
    return;
  }
  const step = effortStep(event);
  if (step) {
    event.preventDefault();
    noteUsed(`shortcut:effort-${step < 0 ? "down" : "up"}`);
    context.stepEffort(step);
    return;
  }
  const quick = context.stepQuick ? quickStep(event) : 0;
  if (quick) {
    event.preventDefault();
    noteUsed(`shortcut:quick-${quick < 0 ? "prev" : "next"}`);
    context.stepQuick?.(quick);
    return;
  }
  const action = sendAction(event, context.sendKey, context.runningAction);
  if (action) {
    event.preventDefault();
    void context.send({ steer: action === "steer" });
  }
}
