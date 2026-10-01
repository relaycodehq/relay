import { useRef, useState, type DragEvent } from "react";
import type { ProjectPlace } from "../../shared/project-folders";
import type { ProjectGroups } from "./useProjectGroups";

const PROJECT_DRAG = "application/x-relay-project";
const GROUP_DRAG = "application/x-relay-group";

export type DropTarget =
  ProjectPlace | { kind: "group"; path: string; where: "before" | "after" };

/** Which half of the row under the pointer, the section's first child, it's in. */
export function dropSide(e: DragEvent<HTMLElement>) {
  const row = e.currentTarget.firstElementChild!.getBoundingClientRect();
  return e.clientY < row.top + row.height / 2 ? "before" : "after";
}

export type ProjectDrag = ReturnType<typeof useProjectDrag>;

/** Dragging projects into groups and beside each other, and groups beside their siblings. */
export function useProjectDrag(
  groups: Pick<ProjectGroups, "moveProject" | "moveGroup">,
  setOpen: (key: string, open: boolean) => void,
) {
  const [dragging, setDragging] = useState<string | null>(null);
  const [draggingGroup, setDraggingGroup] = useState<string | null>(null);
  const [drop, setDrop] = useState<DropTarget | null>(null);
  const expandTimer = useRef<{ key: string; timer: number } | null>(null);
  const end = () => {
    setDragging(null);
    setDraggingGroup(null);
    setDrop(null);
    if (expandTimer.current) clearTimeout(expandTimer.current.timer);
    expandTimer.current = null;
  };
  return {
    /** The project being dragged. */
    dragging,
    draggingGroup,
    /** Where it would land. */
    drop,
    startProject(e: DragEvent, id: string) {
      e.dataTransfer.setData(PROJECT_DRAG, id);
      e.dataTransfer.effectAllowed = "move";
      setDragging(id);
    },
    startGroup(e: DragEvent, path: string) {
      e.dataTransfer.setData(GROUP_DRAG, path);
      e.dataTransfer.effectAllowed = "move";
      setDraggingGroup(path);
    },
    end,
    /** Shared dragover handling: accepts the drag the target takes, marks it. */
    over(e: DragEvent, target: DropTarget) {
      const group = target.kind === "group";
      if (
        !(group ? draggingGroup : dragging) ||
        !e.dataTransfer.types.includes(group ? GROUP_DRAG : PROJECT_DRAG)
      )
        return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = "move";
      setDrop((current) =>
        JSON.stringify(current) === JSON.stringify(target) ? current : target,
      );
    },
    dropOn(e: DragEvent, target: DropTarget) {
      if (target.kind === "group") {
        if (!draggingGroup) return;
        e.preventDefault();
        e.stopPropagation();
        const path = draggingGroup;
        end();
        if (target.path !== path) groups.moveGroup(path, target);
        return;
      }
      if (!dragging) return;
      e.preventDefault();
      e.stopPropagation();
      const id = dragging;
      end();
      if (target.kind === "project" && target.id === id) return;
      groups.moveProject(id, target);
    },
    /** Hovering a collapsed folder while dragging opens it, like Finder. */
    openWhileDragging(key: string, isOpen: boolean) {
      if (isOpen || expandTimer.current?.key === key) return;
      if (expandTimer.current) clearTimeout(expandTimer.current.timer);
      expandTimer.current = {
        key,
        timer: window.setTimeout(() => setOpen(key, true), 550),
      };
    },
  };
}
