import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { Project } from "../../../shared/projects";
import { api } from "../../lib/api";
import { ErrorBox, Modal, Spinner } from "../../ui/ui";
import { NewThreadPicker } from "../projects/NewThreadPicker";
import "./guest-share.css";

/**
 * "Continue in Relay" from a guest page: asks which project the shared
 * conversation carries on in, copies it into a new thread there and opens it.
 */
export function GuestImport({
  link,
  projects,
  current,
  onOpen,
  onAddProject,
  onClose,
}: {
  link: string;
  /** Scratchpad included; undefined until the list has loaded. */
  projects: Project[] | undefined;
  current: string | null;
  onOpen: (projectId: string, chatId: string) => void;
  /** Hides the picker while adding; it comes back with the new project listed. */
  onAddProject: () => void;
  onClose: () => void;
}) {
  const [copying, setCopying] = useState(false);
  const [error, setError] = useState<unknown>();
  const qc = useQueryClient();
  const copyInto = async (destination: () => Promise<Project>) => {
    setCopying(true);
    try {
      const project = await destination();
      const thread = await api.importGuestThread(project.id, link);
      onClose();
      onOpen(project.id, thread.id);
    } catch (e) {
      setError(e);
      setCopying(false);
    }
  };
  if (copying || error)
    return (
      <Modal title="Continue shared thread" onClose={onClose}>
        {error ? (
          <ErrorBox error={error} />
        ) : (
          <p className="guest-share-starting">
            <Spinner /> Copying the conversation…
          </p>
        )}
      </Modal>
    );
  // A Scratchpad folder of its own, as a new Scratchpad thread gets.
  const newScratch = async () => {
    const project = await api.createScratch();
    await qc.invalidateQueries({ queryKey: ["projects"] });
    return project;
  };
  return (
    <NewThreadPicker
      title="Continue shared thread in…"
      // A project on another computer would need the thread started there.
      projects={projects?.filter((p) => !p.scratch && !p.computer)}
      current={current}
      onSelect={(p) => void copyInto(async () => p)}
      onAdd={onAddProject}
      onScratch={() => void copyInto(newScratch)}
      onClose={onClose}
    />
  );
}
