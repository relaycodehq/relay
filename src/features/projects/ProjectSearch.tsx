// Searchable project list adapted from T3 Code's DraftHeroHeadline.
// See THIRD_PARTY_NOTICES.md.
import { useRef, useState, type RefObject } from "react";
import { Combobox } from "@base-ui/react/combobox";
import { Check, Search } from "lucide-react";
import { ProjectBadge } from "./ProjectBadge";
import type { Project } from "../../../shared/projects";
import "./projects.css";

export function ProjectSearch({
  projects,
  current,
  input,
  onSelect,
  onEscape,
}: {
  projects: Project[];
  /** The project in view, chosen until another is picked. */
  current: string | null;
  input: RefObject<HTMLInputElement | null>;
  onSelect: (project: Project) => void;
  onEscape: () => void;
}) {
  const [search, setSearch] = useState("");
  const highlighted = useRef<string | null>(null);
  const query = search.trim().toLocaleLowerCase();
  const matches = projects.filter((item) =>
    `${item.name} ${item.path}`.toLocaleLowerCase().includes(query),
  );

  return (
    <Combobox.Root<string>
      inline
      open
      // The root types this as boolean but passes it through; "always" starts
      // on the first row, so the first ArrowDown doesn't just land on it.
      autoHighlight={"always" as unknown as boolean}
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
      value={current}
      onValueChange={(value) => {
        const next = projects.find((item) => item.id === value);
        if (next) onSelect(next);
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
              onEscape();
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
            onSelect(next);
          }}
        />
      </div>
      <div className="headline-project-scroll">
        {matches.length ? (
          <Combobox.List aria-label="Projects">
            {matches.map((item) => (
              <Combobox.Item
                key={item.id}
                value={item.id}
                aria-label={`${item.name} · ${item.path}`}
                className="headline-project-row"
                onClick={() => {
                  // Picking the selected value fires no change.
                  if (item.id === current) onSelect(item);
                }}
              >
                <ProjectBadge id={item.id} name={item.name} />
                <span className="headline-project-row-label">
                  <strong>{item.name}</strong>
                  <small>{item.path}</small>
                </span>
                {item.id === current && <Check size={14} aria-hidden />}
              </Combobox.Item>
            ))}
          </Combobox.List>
        ) : (
          <p className="headline-project-empty">No matching projects.</p>
        )}
      </div>
    </Combobox.Root>
  );
}
