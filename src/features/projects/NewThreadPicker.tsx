import { useEffect, useRef } from "react";
import { FolderPlus } from "lucide-react";
import { Modal } from "../../ui/ui";
import { ProjectSearch } from "./ProjectSearch";
import type { Project } from "../../../shared/projects";
import "./projects.css";

/**
 * Asks which project a new thread belongs in, starting on the one in view so
 * Enter keeps it but the choice is always in front of you.
 */
export function NewThreadPicker({
  projects,
  current,
  onSelect,
  onAdd,
  onClose,
}: {
  projects: Project[];
  current: string | null;
  onSelect: (project: Project) => void;
  onAdd: () => void;
  onClose: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  // The dialog's showModal() runs after this effect and focuses the close button.
  useEffect(() => {
    const frame = requestAnimationFrame(() => input.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <Modal
      title="New thread in…"
      className="new-thread-picker"
      onClose={onClose}
    >
      <ProjectSearch
        projects={projects}
        current={current}
        input={input}
        onSelect={onSelect}
        onEscape={onClose}
      />
      <button
        type="button"
        className="headline-project-add"
        onClick={() => {
          onClose();
          onAdd();
        }}
      >
        <FolderPlus size={15} aria-hidden />
        Add project folder
      </button>
    </Modal>
  );
}
