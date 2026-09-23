// Inline project switcher adapted from T3 Code's DraftHeroHeadline.
// See THIRD_PARTY_NOTICES.md.
import { useRef, useState } from "react";
import { Popover } from "@base-ui/react/popover";
import { Combobox } from "@base-ui/react/combobox";
import { Check, FolderPlus, Search } from "lucide-react";
import { ProjectBadge } from "./ProjectBadge";
import { ProjectRibbon } from "./ProjectRibbon";
import type { Project } from "../../shared/projects";

export function ProjectHeadlinePicker({
  project,
  projects,
  disabled,
  onSelect,
  onAdd,
}: {
  project: Project;
  projects: Project[];
  disabled: boolean;
  onSelect: (project: Project) => void;
  onAdd: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const highlighted = useRef<string | null>(null);
  const query = search.trim().toLocaleLowerCase();
  const matches = projects.filter((item) =>
    `${item.name} ${item.path}`.toLocaleLowerCase().includes(query),
  );

  function select(next: Project) {
    setOpen(false);
    if (next.id !== project.id) onSelect(next);
  }

  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setSearch("");
          highlighted.current = null;
        }
      }}
    >
      <Popover.Trigger
        type="button"
        className="headline-project-trigger"
        disabled={disabled}
        title={
          disabled
            ? "Save or close the edited file before switching projects"
            : project.path
        }
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
            <Combobox.Root<string>
              inline
              open
              autoHighlight
              items={matches.map((item) => item.id)}
              filter={null}
              inputValue={search}
              onInputValueChange={(value) => {
                highlighted.current = null;
                setSearch(value);
              }}
              onItemHighlighted={(value) => {
                highlighted.current = value ?? null;
              }}
              value={project.id}
              onValueChange={(value) => {
                const next = projects.find((item) => item.id === value);
                if (next) select(next);
              }}
            >
              <div className="headline-project-search">
                <Search size={15} aria-hidden />
                <Combobox.Input
                  ref={input}
                  aria-label="Search projects"
                  placeholder="Search projects…"
                  autoComplete="off"
                  spellCheck={false}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      event.preventDefault();
                      event.stopPropagation();
                      setOpen(false);
                    }
                    if (
                      event.key !== "Enter" ||
                      event.nativeEvent.isComposing ||
                      event.keyCode === 229
                    )
                      return;
                    const next =
                      matches.find((item) => item.id === highlighted.current) ??
                      matches[0];
                    if (!next) return;
                    (
                      event as typeof event & {
                        preventBaseUIHandler?: () => void;
                      }
                    ).preventBaseUIHandler?.();
                    event.preventDefault();
                    event.stopPropagation();
                    select(next);
                  }}
                />
              </div>
              <div className="headline-project-scroll">
                {matches.length ? (
                  <Combobox.List aria-label="Projects">
                    {matches.map((item, index) => (
                      <Combobox.Item
                        key={item.id}
                        value={item.id}
                        index={index}
                        aria-label={`${item.name} · ${item.path}`}
                        className="headline-project-row"
                        data-current={item.id === project.id ? "" : undefined}
                        onClick={() => {
                          if (item.id === project.id) select(item);
                        }}
                      >
                        <ProjectBadge id={item.id} name={item.name} />
                        <span className="headline-project-row-label">
                          <strong>{item.name}</strong>
                          <small>{item.path}</small>
                        </span>
                        {item.id === project.id && (
                          <Check size={14} aria-hidden />
                        )}
                      </Combobox.Item>
                    ))}
                  </Combobox.List>
                ) : (
                  <p className="headline-project-empty">
                    No matching projects.
                  </p>
                )}
              </div>
            </Combobox.Root>
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
