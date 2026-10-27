import type { Project } from "../../shared/projects";
import type { SettingsCategory } from "../lib/settings-page";
import { useElsewhereListed } from "../features/changes/elsewhere/useElsewhere";
import { HandoffButton } from "../features/handoff/HandoffButton";
import type { CardChanges } from "../features/terminal/ChangesSection";
import { RunningTasks } from "../features/terminal/RunningTasks";
import type { ThreadTools } from "./ThreadWorkspace";

/**
 * What the card counts as the thread's changes: its folder's, or for a folder
 * without Git, what its agents changed in other repositories. A PR thread's
 * changes are its Review, which the header opens.
 */
function useCardChanges(
  { nav, folder }: ThreadTools,
  project: Project,
): CardChanges | undefined {
  const elsewhere = useElsewhereListed(
    project.plain ? nav.chat?.id : undefined,
  );
  if (nav.pull) return undefined;
  if (!project.plain)
    return (
      folder.tree && {
        files: folder.tree.changes.length,
        lines: folder.tree.lines,
      }
    );
  const groups = elsewhere.data?.groups ?? [];
  if (!groups.length) return undefined;
  const files = groups.flatMap((g) => g.files);
  return {
    files: files.length,
    lines: {
      additions: files.reduce((sum, f) => sum + f.additions, 0),
      deletions: files.reduce((sum, f) => sum + f.deletions, 0),
    },
    elsewhere: groups.map((g) => g.name),
  };
}

/** The Running card, with Hand off and the changes of the open thread; none on a new thread. */
export function RunningCard({
  tools,
  project,
  onSettings,
}: {
  tools: ThreadTools;
  project: Project;
  onSettings: (at: SettingsCategory) => void;
}) {
  const { nav, opens, setError } = tools;
  const { chat, chats, navigate } = nav;
  const changes = useCardChanges(tools, project);
  const handoff = chat && !project.plain && !project.scratch ? chat : undefined;
  // A new thread has nothing of its own for the card to show yet.
  if (!chat) return null;
  return (
    <RunningTasks
      key={project.id}
      project={project}
      chats={chats.data ?? []}
      handoff={
        handoff &&
        ((className) => (
          <HandoffButton
            chat={handoff}
            className={className}
            onError={setError}
            onSettings={() => onSettings("computers")}
          />
        ))
      }
      changes={changes}
      onOpenChanges={() => opens.openCode("changes")}
      onOpenChat={(c) => navigate(project, c)}
    />
  );
}
