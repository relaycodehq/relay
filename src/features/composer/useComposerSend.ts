import { useEffect, useRef, useState } from "react";
import type { AgentProvider } from "../../../shared/agents";
import { relayCommand } from "../../../shared/commands";
import {
  buildSend,
  planGoAhead,
  type ComposedSend,
} from "../../../shared/compose-send";
import { draftRecipient, type Recipient } from "../../../shared/recipient";
import { dictationSnapshot, stopDictation } from "../dictation/audio/session";
import type { DraftImage } from "../images/draft-images";
import { numberImages } from "../../../shared/image-refs";
import { flattenSketch } from "../images/sketch";
import type { AgentRuns } from "./useAgentRuns";
import type { ComposerDraft } from "./useComposerDraft";
import type { ComposerState } from "./useComposerSettings";

/** Who the draft goes to, and whether a council thinks it over first; see shared/ultraplan. */
export interface SendTarget {
  to: Recipient;
  councilOn: boolean;
}

/** `offered`: the conversation can plan with a council. */
export function sendTarget(
  text: string,
  { provider, ultraplan }: Pick<ComposerState, "provider" | "ultraplan">,
  offered: boolean,
): SendTarget {
  const to = draftRecipient(text, provider);
  return { to, councilOn: offered && ultraplan && to !== "message" };
}

/**
 * Sending the draft to `target.to`: as a message, queued or steering while an
 * answer runs, as a `/btw` on the side, or as the go-ahead for a proposed
 * plan. One goes out at a time.
 */
export function useComposerSend({
  draft,
  state,
  runs,
  target: { to, councilOn },
  conversation: { busy, running },
  complete,
  intercept,
  onSend,
}: {
  draft: ComposerDraft;
  state: ComposerState;
  runs: AgentRuns;
  target: SendTarget;
  conversation: { busy: boolean; running: boolean };
  /** What's attached beside the draft is a complete message on its own. */
  complete: boolean;
  /** Whether something else, like the command menu, takes the send. */
  intercept: () => boolean;
  onSend: (value: ComposedSend, dispatch?: () => void) => Promise<boolean>;
}) {
  const sending = useRef(false);
  const [dictation] = useState(() => ({}));
  const disabled =
    busy ||
    (!draft.text.trim() && !draft.attached.length && !complete) ||
    // A note to the thread has no agent to show a screenshot to.
    (to === "message" && !draft.text.trim()) ||
    draft.preparing ||
    !runs.codex;
  // Sending mid-dictation waits for the last words to land in the draft.
  const [sendAfterDictation, setSendAfterDictation] = useState<{
    steer: boolean;
    sendAt?: number;
    after?: () => void;
  } | null>(null);
  useEffect(() => {
    if (!sendAfterDictation) return;
    setSendAfterDictation(null);
    const { steer, sendAt, after } = sendAfterDictation;
    void send(steer, sendAt, after);
  }, [sendAfterDictation]);
  /** `sendAt` holds the message until then (Send later); `after` runs once it is in. */
  async function send(steer = false, sendAt?: number, after?: () => void) {
    const now = dictationSnapshot();
    if (now.owner === dictation && now.phase !== "idle") {
      void stopDictation().then((finished) => {
        if (finished) setSendAfterDictation({ steer, sendAt, after });
      });
      return;
    }
    // `/btw` goes to the agent picked here, beside whatever the thread runs.
    const btw = relayCommand(draft.text);
    if (btw?.name === "btw" && btw.args && to !== "message") {
      if (busy || sending.current || !runs.codex) return;
      sending.current = true;
      const outgoing = draft.take(false);
      try {
        const sent = await onSend(
          buildSend(runs.sendSettings(to)!, `@${to} ${btw.args}`, {
            side: true,
          }),
          outgoing.dispatch,
        );
        if (!sent) outgoing.restore();
        else after?.();
      } finally {
        sending.current = false;
      }
      return;
    }
    if (busy || intercept()) return;
    if (disabled || sending.current) return;
    const outgoingImages = numberImages(draft.text.trim(), draft.images);
    const body = outgoingImages.text;
    sending.current = true;
    try {
      let flattened: DraftImage[];
      try {
        flattened = await Promise.all(outgoingImages.images.map(flattenSketch));
      } catch {
        draft.setError("Could not apply the drawing to the screenshot.");
        return;
      }
      // A council is one question's worth: follow-ups go to the lead, in
      // Plan. Saved before sending, so a thread it starts opens that way too.
      if (councilOn) {
        state.setUltraplan(false);
        state.save({ ultraplan: false });
      }
      const outgoing = draft.take(true);
      const sent = await onSend(
        buildSend(runs.sendSettings(to)!, body, {
          ...(councilOn ? { council: state.council } : {}),
          ...(running ? { running: { steer } } : {}),
          sendAt,
          images: flattened.map(({ name, mimeType, dataUrl }) => ({
            name,
            mimeType,
            dataUrl,
          })),
        }),
        outgoing.dispatch,
      );
      if (!sent) {
        outgoing.restore();
        if (councilOn) state.setUltraplan(true);
      } else if (to !== "message")
        state.saveLastModel(to, {
          choice: runs.choiceFor(to)!,
          ...runs.contextFor(to),
        });
      if (sent) {
        await draft.forgetSent();
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
      if (!runs.codex || sending.current) return;
      sending.current = true;
      try {
        const { send, nextSettings } = planGoAhead(
          runs.sendSettings(planner)!,
          planner,
        );
        const accepted = await onSend(send);
        if (accepted) {
          state.setProvider(nextSettings.to);
          state.setInteractionMode(nextSettings.interactionMode);
          state.setUltraplan(false);
        }
      } finally {
        sending.current = false;
      }
    },
  };
}
