import { useEffect, useRef, useState } from "react";
import type { QuestionTarget } from "../../../shared/questions";
import { roomMention, type SendRoom } from "../../../shared/rooms";
import type { Pull } from "../../../shared/types";
import { api } from "../../lib/api";
import type { RoomAgent } from "./useRoomAgent";
import { useRoomDraft } from "./useRoomDraft";

/**
 * Writing to a PR room: the draft, the code it's about, which agent its
 * mention asks, and sending it. Lines asked about from the diff become the
 * draft's context.
 */
export function useRoomCompose(
  pull: Pull,
  storageKey: string,
  path: string | undefined,
  target: QuestionTarget | null,
  { claude, choice }: RoomAgent,
) {
  const { draft, setDraft, saveFailed } = useRoomDraft(storageKey);
  const [busy, setBusy] = useState(false),
    [attachFile, setAttachFile] = useState(true);
  const input = useRef<HTMLTextAreaElement>(null);
  const mention = roomMention(draft.text);
  useEffect(() => {
    if (target) {
      setDraft((d) => ({
        ...d,
        text: d.text || "@codex ",
        context: { ...target, head: pull.head.sha, base: pull.merge_base },
        pending: undefined,
      }));
      requestAnimationFrame(() => input.current?.focus());
    }
  }, [target]);
  const updateText = (text: string) =>
    setDraft((d) => ({ ...d, text, pending: undefined }));
  async function send(onError: (e: unknown) => void, onSent: () => void) {
    if (!draft.text.trim() || busy) return;
    setBusy(true);
    onError(undefined);
    const submission: SendRoom = draft.pending ?? {
      id: crypto.randomUUID(),
      body: draft.text.trim(),
      parentId: draft.parentId,
      context: {
        head: pull.head.sha,
        base: pull.merge_base,
        ...(draft.context ?? (attachFile && path ? { path } : {})),
      },
      choice:
        mention?.provider === "claude"
          ? { model: claude.model, reasoningEffort: claude.effort, fast: false }
          : choice,
    };
    setDraft((d) => ({ ...d, pending: submission }));
    try {
      await api.roomSend(pull, submission);
      setDraft({ text: "", parentId: null });
      onSent();
      input.current?.focus();
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  }
  return {
    draft,
    setDraft,
    saveFailed,
    updateText,
    /** The agent the draft's leading mention asks, if any. */
    mention,
    /** Whether the open file goes along when the draft has no lines. */
    attachFile,
    setAttachFile,
    busy,
    input,
    send,
  };
}
export type RoomCompose = ReturnType<typeof useRoomCompose>;
