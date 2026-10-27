import type { ChatSummary, Project } from "../../shared/projects";
import type { SettingsCategory } from "../lib/settings-page";
import { useElsewhereListed } from "../features/changes/elsewhere/useElsewhere";
import { HandoffButton } from "../features/handoff/HandoffButton";
import {
  LiveAwayStatus,
  useLiveAway,
} from "../features/handoff/LiveAwayStatus";
import {
  projectComputer,
  usePairedComputers,
} from "../features/handoff/usePairedComputers";
import type { CardComputer } from "../features/terminal/ComputerSection";
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

/** The other computer the open thread runs on: where it was handed off to, or where its project lives. */
function useCardComputer(
  chat: ChatSummary | undefined,
  project: Project,
  onError: (error: unknown) => void,
): CardComputer | undefined {
  const away = useLiveAway(chat, onError);
  const computers = usePairedComputers(!!project.computer);
  const home = projectComputer(project, computers.data);
  if (away)
    return {
      name: away.computer,
      online: away.online,
      status: <LiveAwayStatus away={away} />,
    };
  return home && { name: home.name, online: home.online };
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
  const computer = useCardComputer(chat, project, setError);
  const handoff = chat && !project.plain && !project.scratch ? chat : undefined;
  // A new thread has nothing of its own for the card to show yet.
  if (!chat) return null;
  return (
    <RunningTasks
      key={project.id}
      project={project}
      computer={computer}
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
