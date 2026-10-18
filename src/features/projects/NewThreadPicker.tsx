import { useEffect, useRef } from "react";
import { Modal } from "../../ui/ui";
import { matches } from "../../lib/shortcuts";
import { ProjectPicker, ScratchpadButton } from "./ProjectPicker";
import type { Project } from "../../../shared/projects";
import "./projects.css";

/**
 * Asks which project a new thread belongs in, starting on the one in view so
 * Enter keeps it but the choice is always in front of you. Scratchpad waits
 * in the heading for a chat that needs no project.
 */
export function NewThreadPicker({
  projects,
  current,
  onSelect,
  onAdd,
  onScratch,
  onClose,
}: {
  /** Undefined until the list has loaded. */
  projects: Project[] | undefined;
  current: string | null;
  onSelect: (project: Project) => void;
  onAdd: () => void;
  onScratch: () => void;
  onClose: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const scratch = useRef(onScratch);
  scratch.current = onScratch;
  // The dialog's showModal() runs after this effect and focuses its first
  // button. The search mounts later when the list was still loading.
  useEffect(() => {
    const frame = requestAnimationFrame(() => input.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [!projects]);
  // Shortcuts stand down while a dialog is open, so the one the heading
  // shows has to be heard here.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.isComposing || e.repeat || !matches("new-scratch", e)) return;
      e.preventDefault();
      scratch.current();
    };
    window.addEventListener("keydown", down);
    return () => window.removeEventListener("keydown", down);
  }, []);

  return (
    <Modal
      title="New thread in…"
      className="new-thread-picker"
      onClose={onClose}
      actions={<ScratchpadButton onClick={onScratch} />}
    >
      {projects && (
        <ProjectPicker
          projects={projects}
          current={current}
          input={input}
          onSelect={onSelect}
          onAdd={onAdd}
          onClose={onClose}
        />
      )}
    </Modal>
  );
}
