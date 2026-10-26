import { useRef, useState } from "react";
import { Popover } from "@base-ui/react/popover";
import { ProjectRibbon } from "./ProjectRibbon";
import { ProjectPicker, ScratchpadButton } from "./ProjectPicker";
import type { Project } from "../../../shared/projects";
import "./projects.css";

/** The New thread dialog as a dropdown, under the project's name. */
export function ProjectHeadlinePicker({
  project,
  projects,
  onSelect,
  onAdd,
  onScratch,
}: {
  project: Project;
  projects: Project[];
  onSelect: (project: Project) => void;
  onAdd: () => void;
  /** Absent where no Scratchpad thread can start, like a thread window. */
  onScratch?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  function select(next: Project) {
    setOpen(false);
    if (next.id !== project.id) onSelect(next);
  }

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        type="button"
        className="headline-project-trigger"
        title={project.path}
      >
        <span className="headline-project-name">{project.name}</span>
        <ProjectRibbon key={project.id} />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner
          className="headline-project-positioner"
          align="center"
          side="bottom"
          sideOffset={9}
          collisionPadding={12}
        >
          <Popover.Popup
            className="headline-project-popup project-picker-popup"
            aria-label="New thread in…"
            initialFocus={input}
          >
            <div className="project-picker-heading">
              <h2>New thread in…</h2>
              {onScratch && (
                <ScratchpadButton
                  onClick={() => {
                    setOpen(false);
                    onScratch();
                  }}
                />
              )}
            </div>
            <ProjectPicker
              projects={projects}
              current={project.id}
              input={input}
              onSelect={select}
              onAdd={() => {
                setOpen(false);
                onAdd();
              }}
              onClose={() => setOpen(false)}
            />
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
