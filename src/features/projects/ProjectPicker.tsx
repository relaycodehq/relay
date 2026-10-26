import type { RefObject } from "react";
import { FolderPlus } from "lucide-react";
import { useShortcutLabel } from "../../lib/shortcuts";
import { ProjectSearch } from "./ProjectSearch";
import type { Project } from "../../../shared/projects";
import "./projects.css";

/** In the heading, for a chat that needs no project. */
export function ScratchpadButton({ onClick }: { onClick: () => void }) {
  const keys = useShortcutLabel("new-scratch");
  return (
    <button type="button" className="project-picker-action" onClick={onClick}>
      <span className="sb-project-badge scratchpad" aria-hidden />
      Scratchpad
      {keys && <kbd>{keys}</kbd>}
    </button>
  );
}

/**
 * Under the heading of the New thread dialog and the headline's dropdown
 * alike: the project search, or a word on adding one, and Add project folder.
 */
export function ProjectPicker({
  projects,
  current,
  input,
  onSelect,
  onAdd,
  onClose,
}: {
  projects: Project[];
  current: string | null;
  input: RefObject<HTMLInputElement | null>;
  onSelect: (project: Project) => void;
  onAdd: () => void;
  onClose: () => void;
}) {
  return (
    <>
      {projects.length ? (
        <ProjectSearch
          projects={projects}
          current={current}
          input={input}
          onSelect={onSelect}
          onEscape={onClose}
        />
      ) : (
        <div className="new-thread-empty">
          <strong>No projects yet</strong>
          <p>
            Add a folder to work in a repository, or start in Scratchpad for
            anything else.
          </p>
        </div>
      )}
      <button
        type="button"
        className="headline-project-add"
        // The caller closes what it needs: an import picker stays to take the new project.
        onClick={onAdd}
      >
        <FolderPlus size={15} aria-hidden />
        Add project folder
      </button>
    </>
  );
}
