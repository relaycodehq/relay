import type { ChatSummary, ProjectChat } from "../../../shared/projects";
import type { Touch, TurnRun } from "../../../shared/time-attribution";

export interface ChatSource {
  summaries(): ChatSummary[];
  get(id: string): Promise<ProjectChat>;
}

/** The threads that moved during the day, loaded. */
export async function dayChats(
  source: ChatSource,
  start: number,
): Promise<ProjectChat[]> {
  const ids = source
    .summaries()
    .filter((c) => c.updated >= start)
    .map((c) => c.id);
  const loaded = await Promise.all(
    ids.map((id) => source.get(id).catch(() => null)),
  );
  return loaded.filter((c): c is ProjectChat => !!c);
}

/**
 * Agent turns and prompts inside the day. A turn that never recorded its end
 * is still running, or ended without saying so; it counts up to `now`.
 */
export function chatEvidence(
  chats: ProjectChat[],
  span: { start: number; end: number },
  now: number,
): { turns: TurnRun[]; touches: Touch[] } {
  const turns: TurnRun[] = [],
    touches: Touch[] = [];
  for (const chat of chats)
    for (const m of chat.messages) {
      if (m.created > span.end) continue;
      if (m.role === "user") {
        if (m.created >= span.start)
          touches.push({
            projectId: chat.projectId,
            chatId: chat.id,
            at: m.created,
          });
        continue;
      }
      const end = m.ended ?? (m.status === "streaming" ? now : m.created);
      if (end < span.start) continue;
      turns.push({
        projectId: chat.projectId,
        chatId: chat.id,
        start: Math.max(m.created, span.start),
        end: Math.min(end, span.end),
      });
    }
  return { turns, touches };
}
