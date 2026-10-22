import type { QueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { fetchChat } from "../../lib/chat-events";
import { threadDraftKey } from "../../lib/thread-storage";
import { readDraft, writeDraft } from "../composer/drafts";

/**
 * Sends a thread on its way again. A thread of a project on another computer
 * that computer refuses to start starts over here, new and empty, so what its
 * first message said goes back in its composer, ahead of anything typed since.
 */
export async function retryHandoff(qc: QueryClient, chatId: string) {
  const chat = await fetchChat(qc, chatId);
  const first = chat.sentTo?.home
    ? chat.messages.find((m) => m.role === "user")?.body.trim()
    : undefined;
  try {
    await api.retryHandoff(chatId);
  } catch (e) {
    if (first && !(await fetchChat(qc, chatId)).messages.length)
      putBack(chatId, first);
    throw e;
  }
}

function putBack(chatId: string, text: string) {
  const key = threadDraftKey(chatId);
  const draft = readDraft(key).trim();
  if (draft === text || draft.startsWith(`${text}\n\n`)) return;
  writeDraft(key, draft ? `${text}\n\n${draft}` : text);
}
