import { chatActivitySection } from "../../shared/chat-activity";
import { listsItsThreads } from "../../shared/computer-threads";
import type { StartedThere } from "../../shared/handoff";
import type {
  ChatSummary,
  ProjectChat,
  StartedBy,
} from "../../shared/projects";
import { workingFor } from "../../shared/projects";
import type { ChatCore } from "./core";
import { chatSummary } from "./chat-summaries";

/**
 * The threads a live handoff's agent started, from both ends. The computer
 * the lead runs on names them; the one following the lead follows them
 * under it and lets go of the ones that computer stops naming.
 */
export class HandoffStarted {
  constructor(
    private core: ChatCore,
    private list: (projectId: string) => ChatSummary[],
  ) {}

  /**
   * The threads the lead's agent started here, for the computer following
   * the lead: this computer's own, not handed on, archived or a deep
   * review's, in a project it lists for the others. A second opinion is left
   * out: sending it to the lead is an action of this computer's. A settled
   * one is named but marked, so it stays the lead's there without being
   * followed for it; one left out is no longer the lead's.
   */
  of(lead: ProjectChat): StartedThere[] {
    const now = Date.now();
    const listable = new Set(
      (this.core.store.get().projects ?? [])
        .filter(listsItsThreads)
        .map((p) => p.id),
    );
    const lists = new Map<string, ChatSummary[]>();
    const listedOf = (c: ChatSummary) => {
      const list = lists.get(c.projectId) ?? this.list(c.projectId);
      lists.set(c.projectId, list);
      return list.find((l) => l.id === c.id) ?? c;
    };
    return (this.core.store.get().chats ?? []).flatMap((c) => {
      if (!c.startedBy || !workingFor(c, lead.id)) return [];
      const ownHere = !c.cameFrom && !c.sentTo;
      const listed =
        !c.archivedAt && c.scope.kind !== "review" && listable.has(c.projectId);
      if (!ownHere || !listed) return [];
      const settled = chatActivitySection(listedOf(c), now) === "settled";
      return [
        {
          id: c.id,
          agent: c.startedBy.agent,
          ...(c.projectId === lead.projectId
            ? { inLeadsProject: true as const }
            : {}),
          ...(settled ? { settled: true as const } : {}),
        },
      ];
    });
  }

  /** The leads of the threads in the project, whose lists of them it may change. */
  leadsIn(projectId: string) {
    const leads = new Set<string>();
    for (const c of this.core.store.get().chats ?? [])
      if (c.projectId === projectId && c.startedBy)
        leads.add(c.startedBy.chatId);
    return leads;
  }

  /**
   * A thread followed from here before it was known to be one a lead's agent
   * started there, opened from the other computer's list: listed under that
   * lead from now on, not only looked at.
   */
  async placeUnder(id: string, startedBy: StartedBy) {
    const chat = await this.core.storage.load(id);
    if (chat.startedBy || !chat.sentTo) return;
    const { peek: _, ...sentTo } = chat.sentTo;
    chat.startedBy = startedBy;
    chat.sentTo = sentTo;
    await this.core.storage.save(chat);
    this.core.storage.chatChanged(id);
  }

  /** A thread its lead's computer no longer counts as the lead's: detached, archived or gone there. */
  async letGo(id: string) {
    const chat = await this.core.storage.load(id);
    if (!chat.startedBy) return chatSummary(chat);
    delete chat.startedBy;
    await this.core.storage.save(chat);
    this.core.storage.chatChanged(id);
    return chatSummary(chat);
  }
}
