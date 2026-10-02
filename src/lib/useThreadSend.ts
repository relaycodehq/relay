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
import { clearDraftWorkspace } from "./drafts";
import type { ComposerAttachments } from "./useComposerAttachments";
import type { NewThread } from "./useNewThread";
import type { ThreadHandle } from "./useThreadHandle";
import type { HeldWrite } from "./write-gate";

/**
 * What the composer sends: a message to the open conversation, a `/btw` on
 * the side, or the stopped answer carried on. An unsent thread is made by
 * its first message.
 */
export function useThreadSend({
  handle: { chat, id, reserve, setError, refetch, listChanged },
  newThread,
  root,
  attachments,
  viewing,
  confirmSwitch,
  onSent,
  onOpen,
}: {
  handle: ThreadHandle;
  /** The thread the first message makes. */
  newThread: NewThread;
  /** The side conversation's first message, while one is open. */
  root?: ChatMessage;
  attachments: ComposerAttachments;
  /** The file open beside the thread, which the agent hears about. */
  viewing: string | null;
  confirmSwitch: (to: AgentProvider | undefined) => Promise<boolean>;
  /** Something went to the agents; the thread follows the answer. */
  onSent: () => void;
  /** Opens a conversation of the thread: a side one by its first message, or the main one. */
  onOpen: (rootId: string | null) => void;
}) {
  async function send(
    value: ComposedSend,
    dispatch?: () => void,
  ): Promise<boolean> {
    // Held from before the switch is asked about: nothing else is written,
    // asked or cleared meanwhile.
    const write = reserve();
    if (!write) return false;
    try {
      if (value.side) return await askAside(value, write, dispatch);
      if (!(await confirmSwitch(agentAsked(value)?.provider))) return false;
      dispatch?.();
      async function post(target: ChatSummary) {
        await api.sendProjectChat(target.id, {
          // A side conversation leaves the thread's attachments waiting.
          ...withAttachments(value, root ? { codeRefs: [] } : attachments),
          id: crypto.randomUUID(),
          ...(root ? { parentId: root.id } : {}),
          ...(viewing ? { viewing } : {}),
        });
        if (!root) attachments.clear();
        onSent();
      }
      return await write.run(async () => {
        if (chat) {
          await post(chat);
          await refetch();
        } else
          await newThread(async (thread) => {
            await post(thread);
            clearDraftWorkspace(id);
            startThreadSettings(id, thread.id, recipient(value));
          });
        await listChanged();
      });
    } finally {
      write.release();
    }
  }
  /** `/btw`: its thread opens, and the main thread's draft and attachments wait. */
  async function askAside(
    value: ComposedSend,
    write: HeldWrite,
    dispatch?: () => void,
  ) {
    if (!chat) {
      setError(
        new Error("Ask the agent something first, then ask on the side."),
      );
      return false;
    }
    dispatch?.();
    return write.run(async () => {
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
    if (!chat) return;
    // Held from before the switch is asked about.
    const write = reserve();
    if (!write) return;
    try {
      const picked = settings();
      if (!(await confirmSwitch(picked?.provider))) return;
      await write.run(async () => {
        await api.resumeProjectChat(chat.id, picked);
        await refetch();
      });
    } finally {
      write.release();
    }
  }
  return { send, resume };
}
