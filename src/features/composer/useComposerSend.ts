import { useEffect, useRef, useState } from "react";
import { agentInfo, type AgentProvider } from "../../../shared/agents";
import { relayCommand } from "../../../shared/commands";
import {
  buildSend,
  planGoAhead,
  type ComposedSend,
} from "../../../shared/compose-send";
import type { Recipient } from "../../../shared/recipient";
import { dictationSnapshot, stopDictation } from "../dictation/audio/session";
import type { DraftImage } from "../images/draft-images";
import { numberImages } from "../../../shared/image-refs";
import { flattenSketch } from "../images/sketch";
import type { AgentRuns } from "./useAgentRuns";
import type { ComposerDraft } from "./useComposerDraft";
import type { ComposerState } from "./useComposerSettings";
import { noteUsed } from "../../lib/used";
import { parseGoalCommand } from "../../../shared/goal";

export interface ComposerSendOptions {
  steer?: boolean;
  /** Holds the message until then (Send later). */
  sendAt?: number;
  /** Runs once the message is accepted. */
  after?: () => void;
  /** Overrides Settings on a cold cache. */
  compact?: boolean;
}

/**
 * Sending the draft to `to`: as a message, queued or steering while an
 * answer runs, as a `/btw` on the side, or as the go-ahead for a proposed
 * plan. One goes out at a time.
 */
export function useComposerSend({
  draft,
  state,
  runs,
  to,
  conversation: { busy, running },
  complete,
  intercept,
  onSend,
}: {
  draft: ComposerDraft;
  state: ComposerState;
  runs: AgentRuns;
  /** Who the draft goes to. */
  to: Recipient;
  conversation: { busy: boolean; running: boolean };
  /** What's attached beside the draft is a complete message on its own. */
  complete: boolean;
  /** Whether something else, like the command menu, takes the send. */
  intercept: () => boolean;
  onSend: (value: ComposedSend, dispatch?: () => void) => Promise<boolean>;
}) {
  const sending = useRef(false);
  const [dictation] = useState(() => ({}));
  const settings = runs.sendSettings(to);
  const disabled =
    busy ||
    (!draft.text.trim() && !draft.attached.length && !complete) ||
    // A note to the thread has no agent to show a screenshot to.
    (to === "message" && !draft.text.trim()) ||
    draft.preparing ||
    !settings;
  // Sending mid-dictation waits for the last words to land in the draft.
  const [sendAfterDictation, setSendAfterDictation] =
    useState<ComposerSendOptions | null>(null);
  useEffect(() => {
    if (!sendAfterDictation) return;
    setSendAfterDictation(null);
    void send(sendAfterDictation);
  }, [sendAfterDictation]);
  async function send({
    steer = false,
    sendAt,
    after,
    compact,
  }: ComposerSendOptions = {}) {
    if (draft.isPreparing()) return;
    const now = dictationSnapshot();
    if (now.owner === dictation && now.phase !== "idle") {
      void stopDictation().then((finished) => {
        if (finished) setSendAfterDictation({ steer, sendAt, after, compact });
      });
      return;
    }
    // `/btw` goes to the agent picked here, beside whatever the thread runs;
    // one that can't take it is told so by the command menu.
    const btw = relayCommand(draft.text);
    if (
      btw?.name === "btw" &&
      btw.args &&
      to !== "message" &&
      agentInfo(to).side
    ) {
      if (busy || sending.current || !settings) return;
      sending.current = true;
      try {
        const prepared = await preparedImages(draft, btw.args);
        if (!prepared) return;
        const outgoing = draft.take(true);
        const sent = await onSend(
          buildSend(settings, `@${to} ${prepared.body}`, {
            side: true,
            sendAt,
            images: prepared.images,
          }),
          outgoing.dispatch,
        );
        if (!sent) return outgoing.restore();
        await outgoing.forget();
        after?.();
      } finally {
        sending.current = false;
      }
      return;
    }
    if (busy || intercept()) return;
    if (disabled || sending.current || !settings) return;
    sending.current = true;
    try {
      const prepared = await preparedImages(draft, draft.text.trim());
      if (!prepared) return;
      const { body, images } = prepared;
      const outgoing = draft.take(true);
      const sent = await onSend(
        buildSend(settings, body, {
          ...(running ? { running: { steer } } : {}),
          sendAt,
          skills: draft.skills(body),
          compact,
          images,
        }),
        outgoing.dispatch,
      );
      if (!sent) {
        outgoing.restore();
      } else if (to !== "message")
        state.saveLastModel(to, {
          choice: runs.choiceFor(to)!,
          ...runs.contextFor(to),
        });
      if (sent) {
        if (parseGoalCommand(body)?.type === "set") noteUsed("goal");
        await outgoing.forget();
        after?.();
      }
    } finally {
      sending.current = false;
    }
  }
  return {
    send,
    /** Sending is off: nothing to send, or not yet. */
    disabled,
    /** Owns the dictation a send waits for. */
    dictation,
    /** Tells `planner` to build the plan it proposed, in Build. */
    async implementPlan(planner: AgentProvider) {
      const settings = runs.sendSettings(planner);
      if (!settings || sending.current) return;
      sending.current = true;
      try {
        const { send, nextSettings } = planGoAhead(settings, planner);
        const accepted = await onSend(send);
        if (accepted) {
          state.setProvider(nextSettings.to);
          state.setInteractionMode(nextSettings.interactionMode);
        }
      } finally {
        sending.current = false;
      }
    },
    /**
     * A line Relay wrote, like a meme's, sent as if typed here: queued
     * behind an answer that runs. The draft is the caller's to clear.
     */
    async sendLine(text: string) {
      // A held Enter or a second click mustn't send it twice.
      if (busy || !settings || sending.current) return false;
      sending.current = true;
      try {
        return await onSend(
          buildSend(
            settings,
            text,
            running ? { running: { steer: false } } : {},
          ),
        );
      } finally {
        sending.current = false;
      }
    },
    /**
     * The goal row's Pause, Resume and Clear, as `/goal …` typed here would
     * go: to the agent holding the goal, on this composer's settings for it.
     * The draft stays.
     */
    sendGoal(provider: AgentProvider, action: "pause" | "resume" | "clear") {
      const settings = runs.sendSettings(provider);
      if (!settings) return Promise.resolve(false);
      return onSend(
        buildSend(
          settings,
          `/goal ${action}`,
          running ? { running: { steer: false } } : {},
        ),
      );
    },
  };
}

/**
 * The draft's screenshots as `text` numbers them, each drawing applied, and
 * the text they're numbered in. Undefined when a drawing couldn't be applied.
 */
async function preparedImages(draft: ComposerDraft, text: string) {
  const numbered = numberImages(text, draft.images);
  let flattened: DraftImage[];
  try {
    flattened = await Promise.all(numbered.images.map(flattenSketch));
  } catch {
    draft.setError("Could not apply the drawing to the screenshot.");
    return undefined;
  }
  const images = flattened.map(({ name, mimeType, dataUrl, browser }) => ({
    name,
    mimeType,
    dataUrl,
    ...(browser ? { browser } : {}),
  }));
  return { body: numbered.text, images };
}
