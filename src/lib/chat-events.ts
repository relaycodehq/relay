import type { QueryClient } from "@tanstack/react-query";
import type { ChatSummary, Project, ProjectChat } from "../../shared/projects";
import { api } from "./api";

/** Under "project-chats", so every refresh of the chat lists reaches it too. */
export const SCRATCH_CHATS = ["project-chats", "scratchpad"];

/**
 * The one place the desktop's pushes reach the query cache. Thread lists
 * arrive whole, so nothing polls for them; a thread's history refetches when
 * a message settles, or when one it doesn't hold yet starts streaming.
 */
export function followChatEvents(qc: QueryClient) {
  const lists = api.onProjectChats(({ projectId, chats }) => {
    qc.setQueryData(["project-chats", projectId], chats);
    const project = qc
      .getQueriesData<Project[]>({ queryKey: ["projects"] })
      .flatMap(([, list]) => list ?? [])
      .find((p) => p.id === projectId);
    // One the window hasn't listed yet may be a new Scratchpad chat's.
    if (!project)
      void qc.invalidateQueries({ queryKey: SCRATCH_CHATS, exact: true });
    else if (project.scratch)
      qc.setQueryData<ChatSummary[]>(SCRATCH_CHATS, (list) =>
        list
          ?.filter((c) => c.projectId !== projectId)
          .concat(chats)
          .sort((a, b) => b.updated - a.updated),
      );
  });
  const messages = api.onProjectChat((e) => {
    const key = ["project-chat", e.chatId];
    // A thread that isn't open isn't fetched; it refetches as it opens.
    const known = qc
      .getQueryData<ProjectChat>(key)
      ?.messages.some((m) => m.id === e.message.id);
    // One that shows up through an event alone, like the answer after a
    // handoff note, would otherwise leave its approvals unfetched.
    if (e.message.status !== "streaming" || !known)
      void qc.invalidateQueries({ queryKey: key, exact: true });
  });
  return () => {
    lists();
    messages();
  };
}
