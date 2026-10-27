import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import type { ChatSummary, Project } from "../../../shared/projects";
import { api } from "../../lib/api";
import { projectChatsQuery } from "../../lib/workspace-queries";
import { ErrorBox, Modal, Spinner } from "../../ui/ui";
import { AddProjectPalette } from "../add-project/AddProjectPalette";
import { HereOnly } from "../add-project/LocationChoice";
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
  onOpen: (project: Project, thread: ChatSummary) => void;
  onClose: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const { copying, error, copyInto, pickAgain } = useGuestCopy(
    link,
    (project, thread) => {
      onClose();
      onOpen(project, thread);
    },
  );
  if (copying || error)
    return (
      <Modal title="Continue shared thread" onClose={onClose}>
        {error ? (
          <>
            <ErrorBox error={error} />
            <div className="modal-actions">
              <button type="button" className="primary" onClick={pickAgain}>
                Choose again
              </button>
            </div>
          </>
        ) : (
          <p className="guest-share-starting">
            <Spinner /> Copying the conversation…
          </p>
        )}
      </Modal>
    );
  const own = projects?.filter((p) => !p.scratch && !p.computer);
  if (adding)
    return (
      // A project on another computer would need the thread started there.
      <HereOnly.Provider value>
        <AddProjectPalette
          projects={own ?? []}
          onClose={() => setAdding(false)}
          onDone={(p) => {
            setAdding(false);
            void copyInto(async () => p);
          }}
        />
      </HereOnly.Provider>
    );
  return (
    <NewThreadPicker
      title="Continue shared thread in…"
      note={
        <>
          Shared from <strong>{new URL(link).host}</strong>. Its messages come
          from someone else&apos;s computer.
        </>
      }
      // A project on another computer would need the thread started there.
      projects={own}
      current={current}
      onSelect={(p) => void copyInto(async () => p)}
      onAdd={() => setAdding(true)}
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
  const open = useRef(true);
  useEffect(() => {
    open.current = true;
    return () => {
      open.current = false;
    };
  }, []);
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
      // Closed, or another link opened, while it copied: the thread is there,
      // and nothing moves under the user.
      if (open.current) onCopied(project, thread);
    } catch (e) {
      setError(e);
      setCopying(false);
    }
  };
  const pickAgain = () => setError(undefined);
  return { copying, error, copyInto, pickAgain };
}
