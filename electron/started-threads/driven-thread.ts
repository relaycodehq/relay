import type { ProjectChat } from "../../shared/projects";
import type { ProjectAccess } from "./project-access";
import type { ThreadReads } from "./thread-reads";

/**
 * A thread the lead may drive. `startedByLead`: the lead started it.
 * `sendsFreely`: the lead may message it as freely as one in its own
 * project. `where` names its project when that's another one.
 */
export async function drivenThread(
  reads: Pick<ThreadReads, "children" | "thread">,
  projects: Pick<ProjectAccess, "real">,
  lead: ProjectChat,
  id: string,
) {
  if (id === lead.id)
    throw new Error("That's this thread; these tools drive other threads.");
  const startedByLead = reads.children(lead).some((c) => c.id === id);
  const found = await reads.thread(id);
  const elsewhere =
    found.chat.projectId !== lead.projectId
      ? ((await projects.real()).find((p) => p.id === found.chat.projectId)
          ?.name ?? "another project")
      : undefined;
  return {
    ...found,
    startedByLead,
    sendsFreely:
      startedByLead && (!elsewhere || !!found.chat.startedBy?.sendsApproved),
    where: elsewhere ? ` in “${elsewhere}”` : "",
  };
}
