import { useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { ComposedSend } from "../../shared/compose-send";
import type {
  AgentProvider,
  ChatMessage,
  ChatSummary,
  ResumeSettings,
} from "../../shared/projects";
import { agentAsked, recipient } from "../../shared/recipient";
import { api } from "./api";
import { startThreadSettings } from "./composer-settings";
import { withAttachments } from "./draft-attachments";
import { saveDraftWorkspace } from "./drafts";
import type { ComposerAttachments } from "./useComposerAttachments";
import type { ThreadWrites } from "./useThreadWrites";

/**
 * What the composer sends: a message to the open conversation, a `/btw` on
 * the side, or the stopped answer carried on. An unsent thread is made by
 * its first message.
 */
export function useThreadSend({
  chat,
  draftId,
  projectId,
  create,
  root,
  attachments,
  viewing,
  writes: { busy, run, setError },
  confirmSwitch,
  refetch,
  onCreated,
  onSent,
  onOpen,
}: {
  chat?: ChatSummary;
  /** The thread's id, or the unsent one's; see lib/drafts. */
  draftId: string;
  projectId: string;
  /** Makes the thread the first message goes to. */
  create: () => Promise<ChatSummary>;
  /** The side conversation's first message, while one is open. */
  root?: ChatMessage;
  attachments: ComposerAttachments;
  /** The file open beside the thread, which the agent hears about. */
  viewing: string | null;
  writes: ThreadWrites;
  confirmSwitch: (to: AgentProvider | undefined) => Promise<boolean>;
  refetch: () => Promise<unknown>;
  onCreated: (c: ChatSummary) => Promise<void>;
  /** Something went to the agents; the thread follows the answer. */
  onSent: () => void;
  /** Opens a conversation of the thread: a side one by its first message, or the main one. */
  onOpen: (rootId: string | null) => void;
}) {
  const qc = useQueryClient();
  const created = useRef<ChatSummary | undefined>(undefined);
  async function send(
    value: ComposedSend,
    dispatch?: () => void,
  ): Promise<boolean> {
    if (busy) return false;
    if (value.side) return askAside(value, dispatch);
    if (!(await confirmSwitch(agentAsked(value)?.provider))) return false;
    dispatch?.();
    return run(async () => {
      const target = chat ?? created.current ?? (await create());
      created.current = target;
      await api.sendProjectChat(target.id, {
        // A side conversation leaves the thread's attachments waiting.
        ...withAttachments(value, root ? { codeRefs: [] } : attachments),
        id: crypto.randomUUID(),
        ...(root ? { parentId: root.id } : {}),
        ...(viewing ? { viewing } : {}),
      });
      if (!root) attachments.clear();
      onSent();
      if (!chat) {
        saveDraftWorkspace(draftId, "checkout");
        startThreadSettings(draftId, target.id, recipient(value));
        await onCreated(target);
      } else await refetch();
      await qc.invalidateQueries({ queryKey: ["project-chats", projectId] });
    });
  }
  /** `/btw`: its thread opens, and the main thread's draft and attachments wait. */
  async function askAside(value: ComposedSend, dispatch?: () => void) {
    if (!chat) {
      setError(
        new Error("Ask the agent something first, then ask on the side."),
      );
      return false;
    }
    dispatch?.();
    return run(async () => {
      const question = crypto.randomUUID();
      await api.sendProjectChat(chat.id, {
        ...value,
        id: question,
        side: true,
      });
      await refetch();
      onOpen(question);
    });
  }
  /** Carries on the stopped answer with whichever agent the composer has picked. */
  async function resume(settings: () => ResumeSettings | undefined) {
    if (!chat || busy) return;
    const picked = settings();
    if (!(await confirmSwitch(picked?.provider))) return;
    await run(async () => {
      await api.resumeProjectChat(chat.id, picked);
      await refetch();
    });
  }
  return { send, resume };
}
