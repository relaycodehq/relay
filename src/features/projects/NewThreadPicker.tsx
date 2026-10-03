import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { FolderPlus } from "lucide-react";
import { Modal } from "../../ui/ui";
import { ProjectSearch } from "./ProjectSearch";
import type { ChatSummary, Project } from "../../../shared/projects";

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
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  // Ordered once on open: running threads keep bumping `updated`, and rows
  // moving under the pointer would pick the wrong project.
  const [order] = useState(() => {
    const lastActive = (id: string) =>
      Math.max(
        0,
        ...(qc.getQueryData<ChatSummary[]>(["project-chats", id]) ?? []).map(
          (c) => c.updated,
        ),
      );
    return [...projects]
      .sort(
        (a, b) =>
          Number(b.id === current) - Number(a.id === current) ||
          lastActive(b.id) - lastActive(a.id),
      )
      .map((p) => p.id);
  });
  const rank = (p: Project) => {
    const i = order.indexOf(p.id);
    return i < 0 ? order.length : i;
  };
  const ordered = [...projects].sort((a, b) => rank(a) - rank(b));
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
        projects={ordered}
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
