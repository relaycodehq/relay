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
  onClose,
}: {
  link: string;
  /** Scratchpad included; undefined until the list has loaded. */
  projects: Project[] | undefined;
  current: string | null;
  onOpen: (projectId: string, chatId: string) => void;
  onClose: () => void;
}) {
  const [copying, setCopying] = useState(false);
  const [error, setError] = useState<unknown>();
  const copyInto = async (project: Project) => {
    setCopying(true);
    try {
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
  const scratch = projects?.find((p) => p.scratch);
  return (
    <NewThreadPicker
      title="Continue shared thread in…"
      projects={projects?.filter((p) => !p.scratch)}
      current={current}
      onSelect={(p) => void copyInto(p)}
      onAdd={onClose}
      onScratch={() => scratch && void copyInto(scratch)}
      onClose={onClose}
    />
  );
}
