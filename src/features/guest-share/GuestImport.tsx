import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { ChatSummary, Project } from "../../../shared/projects";
import { api } from "../../lib/api";
import { projectChatsQuery } from "../../lib/workspace-queries";
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
  onOpen: (project: Project, thread: ChatSummary) => void;
  /** Hides the picker while adding; it comes back with the new project listed. */
  onAddProject: () => void;
  onClose: () => void;
}) {
  const { copying, error, copyInto } = useGuestCopy(link, (project, thread) => {
    onClose();
    onOpen(project, thread);
  });
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
  const own = projects?.filter((p) => !p.scratch && !p.computer);
  return (
    <NewThreadPicker
      title="Continue shared thread in…"
      // A project on another computer would need the thread started there.
      projects={own}
      current={current}
      onSelect={(p) => void copyInto(async () => p)}
      onAdd={onAddProject}
      onScratch={() => void copyInto(() => api.createScratch())}
      onClose={onClose}
    />
  );
}

/** Copies the shared thread into a project, then hands back the project and the new thread. */
function useGuestCopy(
  link: string,
  onCopied: (project: Project, thread: ChatSummary) => void,
) {
  const [copying, setCopying] = useState(false);
  const [error, setError] = useState<unknown>();
  const qc = useQueryClient();
  const copyInto = async (destination: () => Promise<Project>) => {
    if (copying) return;
    setCopying(true);
    try {
      const project = await destination();
      const thread = await api.importGuestThread(project.id, link);
      // Opened by what came back: the lists in view may not have the new project or thread yet.
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["projects"] }),
        qc.invalidateQueries({
          queryKey: projectChatsQuery(project.id).queryKey,
        }),
      ]);
      onCopied(project, thread);
    } catch (e) {
      setError(e);
      setCopying(false);
    }
  };
  return { copying, error, copyInto };
}
