// Inline project switcher adapted from T3 Code's DraftHeroHeadline.
// See THIRD_PARTY_NOTICES.md.
import { useRef, useState } from "react";
import { Popover } from "@base-ui/react/popover";
import { FolderPlus } from "lucide-react";
import { ProjectRibbon } from "./ProjectRibbon";
import { ProjectSearch } from "./ProjectSearch";
import type { Project } from "../../shared/projects";

export function ProjectHeadlinePicker({
  project,
  projects,
  onSelect,
  onAdd,
}: {
  project: Project;
  projects: Project[];
  onSelect: (project: Project) => void;
  onAdd: () => void;
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
            className="headline-project-popup"
            aria-label="Switch project"
            initialFocus={input}
          >
            <ProjectSearch
              projects={projects}
              current={project.id}
              input={input}
              onSelect={select}
              onEscape={() => setOpen(false)}
            />
            <button
              type="button"
              className="headline-project-add"
              onClick={() => {
                setOpen(false);
                onAdd();
              }}
            >
              <FolderPlus size={15} aria-hidden />
              Add project folder
            </button>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
