import type { ChatSummary, Project } from "../../shared/projects";
import { AddProjectPalette } from "../features/add-project/AddProjectPalette";
import { NewThreadPicker } from "../features/projects/NewThreadPicker";
import { GuestImport } from "../features/guest-share/GuestImport";
import type { useNewThreads } from "./useNewThreads";

/** The dialogs that start a thread, add a project or bring in a guest's thread. */
export function StartDialogs({
  starts,
  projects,
  realProjects,
  current,
  guestLink,
  onCloseGuest,
  onOpenChat,
}: {
  starts: ReturnType<typeof useNewThreads>;
  projects: Project[] | undefined;
  /** The projects without the scratchpad. */
  realProjects: Project[];
  current: string | null;
  guestLink: string | undefined;
  onCloseGuest: () => void;
  onOpenChat: (project: Project, thread: ChatSummary) => void;
}) {
  return (
    <>
      {guestLink && (
        <GuestImport
          link={guestLink}
          projects={projects}
          current={current}
          onOpen={onOpenChat}
          onClose={onCloseGuest}
        />
      )}
      {starts.picking && (
        <NewThreadPicker
          projects={projects && realProjects}
          current={current}
          onSelect={(p) => {
            starts.setPicking(false);
            starts.open(p);
          }}
          onAdd={() => starts.addProject()}
          onScratch={() => {
            starts.setPicking(false);
            void starts.scratch();
          }}
          onClose={() => starts.setPicking(false)}
        />
      )}
      {starts.adding && (
        <AddProjectPalette
          projects={realProjects}
          computerId={starts.addingOn}
          initialPage={starts.adding}
          onClose={() => starts.setAdding(false)}
          onDone={(p) => void starts.added(p)}
          onImportWithAgent={(app) => void starts.importThread(app)}
        />
      )}
    </>
  );
}
