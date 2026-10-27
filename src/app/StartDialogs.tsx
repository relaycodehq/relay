import type { Project } from "../../shared/projects";
import { AddProjectPalette } from "../features/add-project/AddProjectPalette";
import { NewThreadPicker } from "../features/projects/NewThreadPicker";
import type { useNewThreads } from "./useNewThreads";

/** The pickers a new thread or a new project starts from, while one is open. */
export function StartDialogs({
  starts,
  projects,
  current,
}: {
  starts: ReturnType<typeof useNewThreads>;
  /** The real projects, scratchpads left out; not there until they've loaded. */
  projects: Project[] | undefined;
  current: string | null;
}) {
  return (
    <>
      {starts.picking && (
        <NewThreadPicker
          projects={projects}
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
          projects={projects ?? []}
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
